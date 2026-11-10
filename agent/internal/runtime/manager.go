// Package runtime turns a built image into a running Service container and keeps
// the Caddy route in front of it correct. A Deployment only replaces the previous
// container after the candidate answers its health check, so a broken release
// never takes traffic away from a working one.
package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HealthCheckTimeout is the spec limit for a candidate to become healthy.
const HealthCheckTimeout = 60 * time.Second

// deployTimeout bounds the whole Deploy so a hung Docker call cannot hold the
// worker forever.
const deployTimeout = 5 * time.Minute

// ErrUnknownService is returned when a Service has no container on this node.
var ErrUnknownService = errors.New("unknown service")

// ErrInvalidDeploy is returned for a Deploy request that cannot be honoured.
var ErrInvalidDeploy = errors.New("invalid deploy request")

// MaxVolumeSizeMB is the spec limit for one Service Volume.
const MaxVolumeSizeMB = 1024

// DeployRequest describes one Deployment the agent must run.
type DeployRequest struct {
	DeploymentID   string
	ServiceID      string
	ProjectID      string
	OrganizationID string
	Hostname       string
	ImageRef       string
	ContainerPort  int
	HealthPath     string
	CPULimit       float64
	MemoryLimitMB  int
	Environment    map[string]string
	Volume         *VolumeMount
}

// VolumeRequest describes a Volume the Control Plane wants the node to own.
type VolumeRequest struct {
	Name           string
	ServiceID      string
	ProjectID      string
	OrganizationID string
	DeploymentID   string
	SizeMB         int
}

// VolumeState is what the Control Plane reads back about a Volume.
type VolumeState struct {
	Name    string
	SizeMB  int
	UsageMB int64
	Exists  bool
}

// DeployResult is the outcome of a Deploy.
type DeployResult struct {
	DeploymentID string
	ServiceID    string
	Status       string
	ContainerID  string
	Hostname     string
	Error        string
}

// ServiceState is the runtime state of one Service.
type ServiceState struct {
	ServiceID    string
	Status       string
	ContainerID  string
	DeploymentID string
	Hostname     string
}

// Manager owns the Service containers on this node.
type Manager struct {
	docker Docker
	router Router
	// networks attaches the routing tier to each Project network, so Caddy can
	// resolve the alias a route dials. Nil skips the step, which the tests use.
	networks NetworkAttacher
	clock    func() time.Time

	// healthTimeout and pollInterval are fields so tests can shorten the wait
	// without relaxing the 60 second production limit.
	healthTimeout time.Duration
	pollInterval  time.Duration

	mu sync.Mutex
	// deploys remembers the result per Deployment id so a retried Deploy returns
	// the same answer instead of starting a second container.
	deploys map[string]DeployResult
	// locks serialises the operations for one Service, so a Stop racing a Deploy
	// cannot leave a container running with no route.
	locks map[string]*sync.Mutex
	// cleanupStatePath is where the last Build-cache prune is recorded, so the
	// weekly prune survives an agent restart. Empty disables the prune.
	cleanupStatePath string
	// backupDir is where Backup artifacts are written; empty disables Backup.
	backupDir string
	// backupArtifacts maps a Backup id to the file it produced.
	backupArtifacts backupArtifacts
	// restoreDir is where an incoming artifact is staged for a Restore.
	restoreDir string
}

// NewManager returns a Manager that runs containers with docker and routes them
// with router.
func NewManager(docker Docker, router Router) *Manager {
	return &Manager{
		docker:        docker,
		router:        router,
		clock:         time.Now,
		healthTimeout: HealthCheckTimeout,
		pollInterval:  1 * time.Second,
		deploys:       make(map[string]DeployResult),
		locks:         make(map[string]*sync.Mutex),
		backupArtifacts: backupArtifacts{
			paths: make(map[string]string),
		},
	}
}

// SetNetworkAttacher configures how Caddy is joined to Project networks. It is a
// separate call so the Manager stays usable with only Docker and a Router.
func (m *Manager) SetNetworkAttacher(networks NetworkAttacher) {
	m.networks = networks
}

// SetCleanupStatePath records where the last Build-cache prune is remembered.
// Without it the weekly prune is skipped, which keeps the Manager usable in tests
// and on a read-only node.
func (m *Manager) SetCleanupStatePath(path string) {
	m.cleanupStatePath = path
}

// Deploy runs a built image as a candidate container, waits for it to become
// healthy, and only then moves the route to it and stops the previous container.
// If the candidate never becomes healthy it is removed and the previous container
// keeps serving, so a failed Deployment is a no-op for users.
func (m *Manager) Deploy(ctx context.Context, request DeployRequest) (DeployResult, error) {
	if err := request.validate(); err != nil {
		return DeployResult{}, err
	}

	if existing, ok := m.finishedDeploy(request); ok {
		return existing, nil
	}

	unlock := m.lockService(request.ServiceID)
	defer unlock()

	// Another caller may have finished this Deployment while this one waited.
	if existing, ok := m.finishedDeploy(request); ok {
		return existing, nil
	}

	// The Deployment must finish even if the Control Plane's request is
	// interrupted, otherwise a dropped connection would leave a container half
	// promoted. The timeout is what bounds it instead.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), deployTimeout)
	defer cancel()

	result := m.deploy(ctx, request)

	m.mu.Lock()
	m.deploys[request.DeploymentID] = result
	m.mu.Unlock()

	return result, nil
}

// finishedDeploy reports a Deploy that already ran. A result remembered in this
// process is used directly; otherwise the serving container's labels are
// consulted, so a retry after an agent restart does not start a second container
// for the same Deployment.
func (m *Manager) finishedDeploy(request DeployRequest) (DeployResult, bool) {
	m.mu.Lock()
	result, ok := m.deploys[request.DeploymentID]
	m.mu.Unlock()
	if ok {
		return result, true
	}

	info, err := m.docker.InspectContainer(context.Background(), serviceContainerName(request.ServiceID))
	if err != nil || info.Labels[LabelDeploymentID] != request.DeploymentID {
		return DeployResult{}, false
	}

	return DeployResult{
		DeploymentID: request.DeploymentID,
		ServiceID:    request.ServiceID,
		Status:       "running",
		ContainerID:  info.ID,
		Hostname:     info.Labels[LabelHostname],
	}, true
}

func (m *Manager) deploy(ctx context.Context, request DeployRequest) DeployResult {
	network := projectNetwork(request.ProjectID)
	containerName := serviceContainerName(request.ServiceID)
	// The candidate gets its own name and its own network alias. The alias is
	// what the Caddy route dials, so the route swap is a single write that
	// atomically moves traffic from the old container to the new one.
	candidateName := candidateContainerName(request.ServiceID)
	candidateAlias := deploymentAlias(request.ServiceID, request.DeploymentID)

	if err := m.docker.EnsureNetwork(ctx, network); err != nil {
		return failedResult(request, fmt.Sprintf("Could not prepare the Project network: %v", err))
	}

	// Caddy has to be a member of the Project network to resolve the alias the
	// route dials, so join it before anything is routed.
	if m.networks != nil {
		if err := m.networks.JoinProjectNetwork(ctx, network); err != nil {
			return failedResult(request, fmt.Sprintf("Could not connect the router to the Project network: %v", err))
		}
	}

	// Remove a leftover candidate from a previous attempt so the name is free.
	if stale, err := m.docker.InspectContainer(ctx, candidateName); err == nil {
		_ = m.docker.RemoveContainer(ctx, stale.ID, true)
	}

	// A Volume is created before the container so a missing Volume is a clear
	// Deployment failure rather than a container that starts and cannot write.
	if request.Volume != nil {
		volume := request.Volume
		if err := m.ensureVolume(ctx, VolumeRequest{
			Name:           volume.Name,
			ServiceID:      request.ServiceID,
			ProjectID:      request.ProjectID,
			OrganizationID: request.OrganizationID,
			DeploymentID:   request.DeploymentID,
			SizeMB:         volume.SizeMB,
		}); err != nil {
			return failedResult(request, err.Error())
		}

		usage, exists, err := m.docker.VolumeUsage(ctx, volume.Name)
		if err != nil {
			return failedResult(request, fmt.Sprintf("Could not read the Volume usage: %v", err))
		}
		if exists && usage > int64(volume.SizeMB) {
			return failedResult(request, fmt.Sprintf(
				"The Volume already uses %d MB, which is over its %d MB limit. Free some space or raise the limit.",
				usage,
				volume.SizeMB,
			))
		}
	}

	spec := ContainerSpec{
		Name:         candidateName,
		Network:      network,
		NetworkAlias: candidateAlias,
		Image:        request.ImageRef,
		Port:         request.ContainerPort,
		CPU:          request.CPULimit,
		MemoryMB:     request.MemoryLimitMB,
		Environment:  request.Environment,
		Volume:       request.Volume,
		ReadOnlyRoot: true,
		Labels: map[string]string{
			LabelType:           ResourceTypeService,
			LabelOrganizationID: request.OrganizationID,
			LabelProjectID:      request.ProjectID,
			LabelServiceID:      request.ServiceID,
			LabelDeploymentID:   request.DeploymentID,
			LabelHostname:       request.Hostname,
			LabelPort:           strconv.Itoa(request.ContainerPort),
			LabelAlias:          candidateAlias,
		},
	}
	if request.Volume != nil {
		spec.Labels[LabelVolumeName] = request.Volume.Name
		spec.Labels[LabelVolumePath] = request.Volume.MountPath
		spec.Labels[LabelVolumeSizeMb] = strconv.Itoa(request.Volume.SizeMB)
	}

	candidateID, err := m.docker.CreateContainer(ctx, spec)
	if err != nil {
		return failedResult(request, fmt.Sprintf("Could not start the container: %v", err))
	}

	// No route points at the candidate alias yet, so an unhealthy candidate
	// receives no traffic. It is removed and the old container keeps serving.
	if err := m.waitHealthy(ctx, candidateID, request); err != nil {
		_ = m.docker.RemoveContainer(ctx, candidateID, true)
		return failedResult(request, err.Error())
	}

	// Health passed. Take the stable name away from the old container first so
	// the candidate can hold it.
	previous, previousErr := m.docker.InspectContainer(ctx, containerName)
	if previousErr == nil {
		if err := m.docker.RenameContainer(ctx, previous.ID, containerName+"-previous"); err != nil {
			_ = m.docker.RemoveContainer(ctx, candidateID, true)
			return failedResult(request, fmt.Sprintf("Could not retire the previous container: %v", err))
		}
	}

	if err := m.docker.RenameContainer(ctx, candidateID, containerName); err != nil {
		_ = m.docker.RemoveContainer(ctx, candidateID, true)
		if previousErr == nil {
			_ = m.docker.RenameContainer(ctx, previous.ID, containerName)
		}
		return failedResult(request, fmt.Sprintf("Could not promote the container: %v", err))
	}

	// The route is re-pointed from the previous container's alias to the new
	// one. Each container has its own alias, so the swap is a single route write
	// with no window where both answer the same name.
	if err := m.router.PutRoute(ctx, Route{
		Hostname:     request.Hostname,
		Upstream:     upstream(candidateAlias, request.ContainerPort),
		ServiceID:    request.ServiceID,
		DeploymentID: request.DeploymentID,
	}); err != nil {
		// The route still points at the old container, so the old container must
		// keep running: undo the promotion and drop the candidate.
		_ = m.docker.RemoveContainer(ctx, candidateID, true)
		if previousErr == nil {
			_ = m.docker.RenameContainer(ctx, previous.ID, containerName)
		}
		return failedResult(request, fmt.Sprintf("Could not update the route: %v", err))
	}

	// Traffic is on the new container, so the old one can go.
	if previousErr == nil {
		// Any Custom Domain route dialled the previous container's alias. Move it
		// to the new alias before the old container disappears, so a redeploy does
		// not leave an active Custom Domain pointing at a removed container.
		if previousAlias := previous.Labels[LabelAlias]; previousAlias != "" {
			previousPort := request.ContainerPort
			if port, err := containerPortOf(previous); err == nil {
				previousPort = port
			}
			oldUpstream := upstream(previousAlias, previousPort)
			newUpstream := upstream(candidateAlias, request.ContainerPort)
			if oldUpstream != newUpstream {
				if err := m.repointRoutes(ctx, oldUpstream, newUpstream, request); err != nil {
					log.Printf("deploy: could not move Custom Domain routes for %s: %v", request.ServiceID, err)
				}
			}
		}

		_ = m.docker.StopContainer(ctx, previous.ID)
		_ = m.docker.RemoveContainer(ctx, previous.ID, false)
	}

	return DeployResult{
		DeploymentID: request.DeploymentID,
		ServiceID:    request.ServiceID,
		Status:       "running",
		ContainerID:  candidateID,
		Hostname:     request.Hostname,
	}
}

// ensureVolume creates the Volume when needed and labels it with its owners. The
// labels are what let Cleanup and Remove find it without asking the Control Plane.
func (m *Manager) ensureVolume(ctx context.Context, request VolumeRequest) error {
	if err := validateVolumeRequest(request); err != nil {
		return err
	}

	labels := map[string]string{
		LabelType:           ResourceTypeVolume,
		LabelOrganizationID: request.OrganizationID,
		LabelProjectID:      request.ProjectID,
		LabelServiceID:      request.ServiceID,
	}
	if request.DeploymentID != "" {
		labels[LabelDeploymentID] = request.DeploymentID
	}

	if err := m.docker.EnsureVolume(ctx, VolumeSpec{
		Name:   request.Name,
		SizeMB: request.SizeMB,
		Labels: labels,
	}); err != nil {
		return fmt.Errorf("Could not prepare the Volume: %v", err)
	}

	return nil
}

// EnsureVolume creates or adopts a Volume and reports its usage, so the Control
// Plane can show the same numbers the node enforces.
func (m *Manager) EnsureVolume(ctx context.Context, request VolumeRequest) (VolumeState, error) {
	if err := m.ensureVolume(ctx, request); err != nil {
		return VolumeState{}, err
	}

	return m.volumeState(ctx, request.Name, request.SizeMB)
}

// GetVolume reports a Volume's limit and usage. A Volume that does not exist yet
// answers `Exists: false` instead of an error, because a Service with a Volume row
// may not have been deployed since the node lost its data.
func (m *Manager) GetVolume(ctx context.Context, name string, sizeMB int) (VolumeState, error) {
	if strings.TrimSpace(name) == "" {
		return VolumeState{}, fmt.Errorf("%w: volume name is required", ErrInvalidDeploy)
	}

	return m.volumeState(ctx, name, sizeMB)
}

func (m *Manager) volumeState(ctx context.Context, name string, sizeMB int) (VolumeState, error) {
	usage, exists, err := m.docker.VolumeUsage(ctx, name)
	if err != nil {
		return VolumeState{}, err
	}

	return VolumeState{Name: name, SizeMB: sizeMB, UsageMB: usage, Exists: exists}, nil
}

// RemoveVolume deletes one Volume and its data, reporting whether it existed.
func (m *Manager) RemoveVolume(ctx context.Context, name string) (bool, error) {
	if strings.TrimSpace(name) == "" {
		return false, fmt.Errorf("%w: volume name is required", ErrInvalidDeploy)
	}

	return m.docker.RemoveVolume(ctx, name)
}

// EnforceVolumes stops a Service container whose Volume is over its limit. Docker's
// local driver cannot enforce a per-Volume quota, so the node enforces it by
// measuring and stopping the writer instead of letting it fill the disk.
func (m *Manager) EnforceVolumes(ctx context.Context) (int, error) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeService})
	if err != nil {
		return 0, err
	}

	stopped := 0
	for _, container := range containers {
		if !container.Running() {
			continue
		}

		name := container.Labels[LabelVolumeName]
		if name == "" {
			continue
		}
		sizeMB, err := strconv.Atoi(container.Labels[LabelVolumeSizeMb])
		if err != nil || sizeMB <= 0 {
			continue
		}

		usage, exists, err := m.docker.VolumeUsage(ctx, name)
		if err != nil || !exists || usage <= int64(sizeMB) {
			continue
		}

		log.Printf(
			"volume %s uses %d MB, over its %d MB limit; stopping Service %s",
			name,
			usage,
			sizeMB,
			container.Labels[LabelServiceID],
		)
		if err := m.docker.StopContainer(ctx, container.ID); err != nil {
			log.Printf("volume %s: could not stop the over-quota container: %v", name, err)
			continue
		}
		stopped++
	}

	return stopped, nil
}

// waitHealthy polls until the container answers on its port and, when a health
// path is configured, returns a 2xx. The probe runs in the container's network
// namespace so it works identically on Linux and Docker Desktop, where the
// container IP is not routable from the host.
func (m *Manager) waitHealthy(ctx context.Context, containerID string, request DeployRequest) error {
	deadline := m.clock().Add(m.healthTimeout)
	path := request.HealthPath
	if path == "" {
		path = "/"
	}

	var lastError string
	for {
		err := m.docker.Probe(ctx, containerID, probeScript(request.ContainerPort, path))
		if err == nil {
			return nil
		}
		lastError = err.Error()

		// A container that already exited will never become healthy, so waiting
		// the full timeout would only delay the failure.
		info, inspectErr := m.docker.InspectContainer(ctx, containerID)
		if inspectErr == nil && info.State == "exited" {
			return errors.New("The container exited before it became healthy.")
		}

		if !m.clock().Before(deadline) {
			return fmt.Errorf(
				"The container did not become healthy within %s: %s",
				m.healthTimeout,
				strings.TrimSpace(lastError),
			)
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("The health check was interrupted: %w", ctx.Err())
		case <-time.After(m.pollInterval):
		}
	}
}

// probeScript checks the port and then the health path, so a Service that listens
// but is not ready is not considered healthy. Each step explains itself on
// failure, because the Deployment error is the only thing the user sees and "exit
// status 1" does not say whether the port was wrong or the app returned an error.
func probeScript(port int, path string) string {
	// `nc -z` proves the port is open; `wget` exits non-zero on a non-2xx
	// response, which is exactly the "is the app ready" question. BusyBox
	// provides both, so the probe image needs no extra tooling.
	return fmt.Sprintf(
		"nc -z -w 2 127.0.0.1 %d || { echo \"nothing is listening on port %d\"; exit 1; }; "+
			"wget -q -T 5 -O /dev/null http://%s || { echo \"GET %s did not return a 2xx response\"; exit 1; }",
		port,
		port,
		upstream("127.0.0.1", port)+path,
		path,
	)
}

// Stop stops the Service container without removing it, so Start can bring the
// same container back and the route can be restored.
func (m *Manager) Stop(ctx context.Context, serviceID string) (ServiceState, error) {
	unlock := m.lockService(serviceID)
	defer unlock()

	info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID))
	if err != nil {
		return ServiceState{}, ErrUnknownService
	}

	if err := m.docker.StopContainer(ctx, info.ID); err != nil {
		return ServiceState{}, err
	}

	// Withdraw the route so the hostname stops answering instead of proxying to
	// a stopped container.
	if hostname := info.Labels[LabelHostname]; hostname != "" {
		if err := m.router.DeleteRoute(ctx, hostname); err != nil {
			return ServiceState{}, err
		}
	}

	return m.state(ctx, serviceID)
}

// Start starts a previously stopped container and restores its route.
func (m *Manager) Start(ctx context.Context, serviceID string) (ServiceState, error) {
	unlock := m.lockService(serviceID)
	defer unlock()

	info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID))
	if err != nil {
		return ServiceState{}, ErrUnknownService
	}

	if err := m.docker.StartContainer(ctx, info.ID); err != nil {
		return ServiceState{}, err
	}

	if err := m.restoreRoute(ctx, info); err != nil {
		return ServiceState{}, err
	}

	return m.state(ctx, serviceID)
}

// Restart restarts the container without changing its configuration. The route
// stays in place because Caddy reconnects to the same upstream.
func (m *Manager) Restart(ctx context.Context, serviceID string) (ServiceState, error) {
	unlock := m.lockService(serviceID)
	defer unlock()

	info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID))
	if err != nil {
		return ServiceState{}, ErrUnknownService
	}

	if err := m.docker.RestartContainer(ctx, info.ID); err != nil {
		return ServiceState{}, err
	}

	// Re-programming the route is cheap and covers a Caddy that was reloaded
	// while the container was restarting.
	if err := m.restoreRoute(ctx, info); err != nil {
		return ServiceState{}, err
	}

	return m.state(ctx, serviceID)
}

// Remove stops the container, deletes its route, and removes the container and
// Volume so a deleted Service leaves nothing behind on the node.
func (m *Manager) Remove(ctx context.Context, serviceID string) (ServiceState, error) {
	unlock := m.lockService(serviceID)
	defer unlock()

	if info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID)); err == nil {
		if hostname := info.Labels[LabelHostname]; hostname != "" {
			if err := m.router.DeleteRoute(ctx, hostname); err != nil {
				return ServiceState{}, err
			}
		}

		// A Custom Domain route has no label of its own; remove every route that
		// dials this container so a deleted Service leaves nothing serving.
		if alias := info.Labels[LabelAlias]; alias != "" {
			if port, err := containerPortOf(info); err == nil {
				if err := m.removeRoutesForUpstream(ctx, upstream(alias, port)); err != nil {
					return ServiceState{}, err
				}
			}
		}

		_ = m.docker.StopContainer(ctx, info.ID)
		if err := m.docker.RemoveContainer(ctx, info.ID, true); err != nil {
			return ServiceState{}, err
		}
	}

	// The Volume is removed even when the container was already gone, so a
	// half-cleaned Service cannot leave a Volume with customer data behind.
	volumes, err := m.docker.ListVolumes(ctx, map[string]string{
		LabelType:      ResourceTypeVolume,
		LabelServiceID: serviceID,
	})
	if err != nil {
		return ServiceState{}, err
	}
	for _, volume := range volumes {
		if _, err := m.docker.RemoveVolume(ctx, volume.Name); err != nil {
			return ServiceState{}, err
		}
	}

	return ServiceState{ServiceID: serviceID, Status: "absent"}, nil
}

// State reports the runtime state of one Service.
func (m *Manager) State(ctx context.Context, serviceID string) (ServiceState, error) {
	return m.state(ctx, serviceID)
}

func (m *Manager) state(ctx context.Context, serviceID string) (ServiceState, error) {
	info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID))
	if err != nil {
		return ServiceState{ServiceID: serviceID, Status: "absent"}, nil
	}

	status := "stopped"
	if info.Running() {
		status = "running"
	}

	return ServiceState{
		ServiceID:    serviceID,
		Status:       status,
		ContainerID:  info.ID,
		DeploymentID: info.Labels[LabelDeploymentID],
		Hostname:     info.Labels[LabelHostname],
	}, nil
}

// Logs streams the Service container's output with the time each line was written.
func (m *Manager) Logs(
	ctx context.Context,
	serviceID string,
	tail int,
	follow bool,
	onLine func(writtenAt time.Time, line string),
) error {
	info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID))
	if err != nil {
		return ErrUnknownService
	}

	return m.docker.Logs(ctx, info.ID, tail, follow, onLine)
}

// Reconcile rebuilds the node's view after an agent restart. Containers carry
// the labels the agent wrote, so it can re-attach each running Service to the
// Project network and re-program its route without duplicating either.
func (m *Manager) Reconcile(ctx context.Context) error {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeService})
	if err != nil {
		return err
	}

	existing, err := m.router.ListRoutes(ctx)
	if err != nil {
		return err
	}

	// A route whose container is gone must be removed, otherwise Caddy answers
	// 502 for a Service that no longer exists. Candidates are skipped: they do
	// not hold the hostname yet. A Custom Domain route has no label of its own,
	// so it counts as live while it dials a running container's alias.
	live := make(map[string]bool, len(containers))
	liveUpstreams := make(map[string]bool, len(containers))
	for _, container := range containers {
		if !container.Running() {
			continue
		}
		if hostname := container.Labels[LabelHostname]; hostname != "" {
			live[hostname] = true
		}
		if alias := container.Labels[LabelAlias]; alias != "" {
			if port, err := containerPortOf(container); err == nil {
				liveUpstreams[upstream(alias, port)] = true
			}
		}
	}
	for _, route := range existing {
		if live[route.Hostname] || liveUpstreams[route.Upstream] {
			continue
		}
		if err := m.router.DeleteRoute(ctx, route.Hostname); err != nil {
			log.Printf("reconcile: could not remove stale route %s: %v", route.Hostname, err)
		}
	}

	for _, container := range containers {
		// A stopped Service keeps its container but must not serve traffic.
		if !container.Running() {
			continue
		}
		// A leftover candidate has no route and must not be resurrected.
		if strings.HasSuffix(container.Name, candidateSuffix) {
			continue
		}

		serviceID := container.Labels[LabelServiceID]
		hostname := container.Labels[LabelHostname]
		projectID := container.Labels[LabelProjectID]
		alias := container.Labels[LabelAlias]
		if serviceID == "" || hostname == "" || projectID == "" || alias == "" {
			continue
		}

		network := projectNetwork(projectID)
		// Caddy needs the same membership to resolve the alias after a restart.
		if m.networks != nil {
			if err := m.networks.JoinProjectNetwork(ctx, network); err != nil {
				log.Printf("reconcile: could not connect the router to %s: %v", network, err)
			}
		}
		// `docker network connect` fails for a container that is already a
		// member, so only attach when the network is missing.
		if !container.OnNetwork(network) {
			if err := m.docker.ConnectNetwork(ctx, network, container.ID, alias); err != nil {
				log.Printf("reconcile: could not attach %s to its network: %v", serviceID, err)
				continue
			}
		}

		port, err := containerPortOf(container)
		if err != nil {
			log.Printf("reconcile: %v", err)
			continue
		}

		if err := m.router.PutRoute(ctx, Route{
			Hostname:     hostname,
			Upstream:     upstream(alias, port),
			ServiceID:    serviceID,
			DeploymentID: container.Labels[LabelDeploymentID],
		}); err != nil {
			log.Printf("reconcile: could not restore route for %s: %v", serviceID, err)
		}
	}

	// Database containers are not routed, but they still have to be on their
	// Project network for the Services to reach them after a restart.
	m.reconcileDatabases(ctx)

	// A public proxy is a second container that must follow the same network
	// after a restart, or the listener would be up but unable to reach its
	// Database.
	m.reconcileDatabaseProxies(ctx)

	return nil
}

// restoreRoute re-programs the route for an existing container from its labels,
// so Start and Restart never need the Service row.
func (m *Manager) restoreRoute(ctx context.Context, info ContainerInfo) error {
	hostname := info.Labels[LabelHostname]
	alias := info.Labels[LabelAlias]
	if hostname == "" || alias == "" {
		return nil
	}

	port, err := containerPortOf(info)
	if err != nil {
		return err
	}

	return m.router.PutRoute(ctx, Route{
		Hostname:     hostname,
		Upstream:     upstream(alias, port),
		ServiceID:    info.Labels[LabelServiceID],
		DeploymentID: info.Labels[LabelDeploymentID],
	})
}

// repointRoutes moves every route that dials oldUpstream to newUpstream. The
// Platform Subdomain is skipped because Deploy already wrote it; everything else
// is a Custom Domain route and must follow the new container. Failing to move a
// route is logged rather than fatal: the release is already serving and the
// Control Plane can re-route the domain on the next verify.
func (m *Manager) repointRoutes(
	ctx context.Context,
	oldUpstream string,
	newUpstream string,
	request DeployRequest,
) error {
	routes, err := m.router.ListRoutes(ctx)
	if err != nil {
		return err
	}

	for _, route := range routes {
		if route.Upstream != oldUpstream || route.Hostname == request.Hostname {
			continue
		}

		if err := m.router.PutRoute(ctx, Route{
			Hostname:     route.Hostname,
			Upstream:     newUpstream,
			ServiceID:    request.ServiceID,
			DeploymentID: request.DeploymentID,
		}); err != nil {
			return fmt.Errorf("move route %s: %w", route.Hostname, err)
		}
	}

	return nil
}

// removeRoutesForUpstream deletes every route that dials upstream. Remove uses
// it to take Custom Domain routes down with the container they pointed at.
func (m *Manager) removeRoutesForUpstream(ctx context.Context, upstream string) error {
	routes, err := m.router.ListRoutes(ctx)
	if err != nil {
		return err
	}

	for _, route := range routes {
		if route.Upstream != upstream {
			continue
		}
		if err := m.router.DeleteRoute(ctx, route.Hostname); err != nil {
			return fmt.Errorf("remove route %s: %w", route.Hostname, err)
		}
	}

	return nil
}

// lockService serialises the runtime operations of one Service and returns the
// matching unlock function.
func (m *Manager) lockService(serviceID string) func() {
	m.mu.Lock()
	lock, ok := m.locks[serviceID]
	if !ok {
		lock = &sync.Mutex{}
		m.locks[serviceID] = lock
	}
	m.mu.Unlock()

	lock.Lock()

	return lock.Unlock
}

func failedResult(request DeployRequest, message string) DeployResult {
	return DeployResult{
		DeploymentID: request.DeploymentID,
		ServiceID:    request.ServiceID,
		Status:       "failed",
		Hostname:     request.Hostname,
		Error:        message,
	}
}

// projectNetwork is the per-Project bridge network. Services in the same Project
// share it, which is how a Service reaches its Database; nothing else can join.
func projectNetwork(projectID string) string {
	return "stealth-project-" + sanitizeID(projectID)
}

// sanitizeID turns an identifier into something Docker accepts in a container,
// network, or alias name.
func sanitizeID(value string) string {
	var builder strings.Builder
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9':
			builder.WriteRune(char)
		default:
			builder.WriteRune('-')
		}
	}

	return builder.String()
}

// deploymentAlias is the network name a container answers to. It is unique per
// Deployment, which is what makes a route swap atomic: re-pointing the route at
// the new alias moves traffic in one write, with no window where two releases
// share a name.
//
// The alias has to stay within one DNS label (63 characters), otherwise Docker's
// embedded DNS cannot answer for it and Caddy fails with "no such host". Service
// and Deployment ids are UUIDs, so they are folded into a short hash rather than
// concatenated: the full pair would be 77 characters.
func deploymentAlias(serviceID, deploymentID string) string {
	sum := sha256.Sum256([]byte(serviceID + "\x00" + deploymentID))
	return "svc-" + hex.EncodeToString(sum[:])[:aliasHashLength]
}

// aliasHashLength keeps `svc-` plus the hash inside the 63 character DNS label
// limit with room to spare.
const aliasHashLength = 32

// serviceContainerName is the stable container name per Service.
func serviceContainerName(serviceID string) string {
	return "stealth-svc-" + sanitizeID(serviceID)
}

// candidateSuffix marks the throwaway name a container starts under before it is
// promoted to the stable name.
const candidateSuffix = "-candidate"

func candidateContainerName(serviceID string) string {
	return serviceContainerName(serviceID) + candidateSuffix
}

// containerPortOf reads the container port back from the labels, so Start and
// reconcile do not need the Service row.
func containerPortOf(info ContainerInfo) (int, error) {
	value, ok := info.Labels[LabelPort]
	if !ok {
		return 0, fmt.Errorf("container %s has no %s label", info.Name, LabelPort)
	}

	port, err := strconv.Atoi(value)
	if err != nil || port <= 0 || port > 65535 {
		return 0, fmt.Errorf("container %s has an invalid %s label %q", info.Name, LabelPort, value)
	}

	return port, nil
}

// validateVolumeRequest rejects a Volume the agent could not create or mount.
func validateVolumeRequest(request VolumeRequest) error {
	switch {
	case !volumeNamePattern.MatchString(request.Name):
		return fmt.Errorf("%w: volume name %q is not a valid Docker volume name", ErrInvalidDeploy, request.Name)
	case strings.TrimSpace(request.ServiceID) == "":
		return fmt.Errorf("%w: serviceId is required", ErrInvalidDeploy)
	case strings.TrimSpace(request.ProjectID) == "":
		return fmt.Errorf("%w: projectId is required", ErrInvalidDeploy)
	case strings.TrimSpace(request.OrganizationID) == "":
		return fmt.Errorf("%w: organizationId is required", ErrInvalidDeploy)
	case request.SizeMB <= 0 || request.SizeMB > MaxVolumeSizeMB:
		return fmt.Errorf("%w: sizeMb must be between 1 and %d", ErrInvalidDeploy, MaxVolumeSizeMB)
	}

	return nil
}

// volumeNamePattern is Docker's own rule for a Volume name.
var volumeNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)

func upstream(host string, port int) string {
	return host + ":" + strconv.Itoa(port)
}

// validate rejects a Deploy that could not produce a working container.
func (r DeployRequest) validate() error {
	switch {
	case strings.TrimSpace(r.DeploymentID) == "":
		return fmt.Errorf("%w: deploymentId is required", ErrInvalidDeploy)
	case strings.TrimSpace(r.ServiceID) == "":
		return fmt.Errorf("%w: serviceId is required", ErrInvalidDeploy)
	case strings.TrimSpace(r.ProjectID) == "":
		return fmt.Errorf("%w: projectId is required", ErrInvalidDeploy)
	case strings.TrimSpace(r.ImageRef) == "":
		return fmt.Errorf("%w: imageRef is required", ErrInvalidDeploy)
	case strings.TrimSpace(r.Hostname) == "":
		return fmt.Errorf("%w: hostname is required", ErrInvalidDeploy)
	case r.ContainerPort <= 0 || r.ContainerPort > 65535:
		return fmt.Errorf("%w: containerPort must be between 1 and 65535", ErrInvalidDeploy)
	case r.MemoryLimitMB <= 0:
		return fmt.Errorf("%w: memoryLimitMb must be positive", ErrInvalidDeploy)
	case r.CPULimit <= 0:
		return fmt.Errorf("%w: cpuLimit must be positive", ErrInvalidDeploy)
	}

	return nil
}
