package runtime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeDocker stands in for the docker CLI so the Manager's state machine can be
// tested without a daemon. It records what the Manager asked for, which is how
// the tests assert that limits, labels, and hardening are actually applied.
type fakeDocker struct {
	mu         sync.Mutex
	nextID     int
	networks   map[string]bool
	containers map[string]*fakeContainer
	images     map[string]time.Time
	volumes    map[string]*fakeVolume

	createErr  error
	connectErr error
	renameErr  error
	removeErr  error
	imageErr   error
	pruneErr   error
	volumeErr  error
	pruneCalls int
	// probeErr makes every Probe fail, which is how a failing health check is
	// simulated. probeErrAfter lets a probe succeed only on a later attempt.
	probeErr      error
	probeErrAfter int
	probeCalls    int
	// exitedMakesUnhealthy reports the container as exited once probed, so the
	// Manager stops waiting early instead of burning the whole timeout.
	exitedAfterProbe bool

	created []ContainerSpec
	stopped []string
	removed []string
	renamed map[string]string
	// stats is what ContainerStats reports, keyed by container id, so the usage
	// tests can set measured CPU and memory.
	stats map[string]ContainerStats

	// volumeFiles records what WriteVolumeFiles wrote, keyed by Volume and file
	// name, so the proxy tests can assert the generated configuration and TLS
	// material.
	volumeFiles map[string]map[string]string
	writeErr    error

	// execErr makes every Exec fail, which is how a Database that never becomes
	// ready or a failed rotation is simulated.
	execErr   error
	execCalls []fakeExec

	// dumpErr and archiveErr simulate a Backup that cannot be produced. The
	// recorded calls let the Backup tests assert the container and Volume names.
	dumpErr    error
	archiveErr error
	dumped     []string
	archived   []string
}

type fakeExec struct {
	ContainerID string
	Command     []string
	Stdin       string
}

type fakeContainer struct {
	ID       string
	Name     string
	State    string
	Image    string
	Labels   map[string]string
	Networks map[string]string
	Logs     []string
	// PublishedPorts mirrors the host ports Docker would publish for the
	// container, which is how the proxy allocator avoids a port collision.
	PublishedPorts []int
}

type fakeVolume struct {
	Name    string
	Labels  map[string]string
	UsageMB int64
}

func newFakeDocker() *fakeDocker {
	return &fakeDocker{
		networks:    make(map[string]bool),
		containers:  make(map[string]*fakeContainer),
		images:      make(map[string]time.Time),
		volumes:     make(map[string]*fakeVolume),
		renamed:     make(map[string]string),
		stats:       make(map[string]ContainerStats),
		volumeFiles: make(map[string]map[string]string),
	}
}

func (f *fakeDocker) EnsureNetwork(_ context.Context, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.networks[name] = true

	return nil
}

func (f *fakeDocker) CreateContainer(_ context.Context, spec ContainerSpec) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.createErr != nil {
		return "", f.createErr
	}
	if _, exists := f.find(spec.Name); exists {
		return "", fmt.Errorf("container name %q is already in use", spec.Name)
	}

	f.nextID++
	container := &fakeContainer{
		ID:       fmt.Sprintf("container-%d", f.nextID),
		Name:     spec.Name,
		State:    "running",
		Image:    spec.Image,
		Labels:   spec.Labels,
		Networks: map[string]string{spec.Network: spec.NetworkAlias},
	}
	if spec.PublishedPort > 0 {
		container.PublishedPorts = []int{spec.PublishedPort}
	}
	f.containers[container.ID] = container
	f.created = append(f.created, spec)

	return container.ID, nil
}

func (f *fakeDocker) InspectContainer(_ context.Context, name string) (ContainerInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	container, ok := f.find(name)
	if !ok {
		return ContainerInfo{}, fmt.Errorf("no such container: %s", name)
	}

	networks := make([]string, 0, len(container.Networks))
	for network := range container.Networks {
		networks = append(networks, network)
	}

	return ContainerInfo{
		ID:             container.ID,
		Name:           container.Name,
		State:          container.State,
		Image:          container.Image,
		Labels:         container.Labels,
		Networks:       networks,
		PublishedPorts: append([]int(nil), container.PublishedPorts...),
	}, nil
}

func (f *fakeDocker) ListContainers(_ context.Context, labels map[string]string) ([]ContainerInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	var containers []ContainerInfo
	for _, container := range f.containers {
		if !matchesLabels(container.Labels, labels) {
			continue
		}
		networks := make([]string, 0, len(container.Networks))
		for network := range container.Networks {
			networks = append(networks, network)
		}
		containers = append(containers, ContainerInfo{
			ID:             container.ID,
			Name:           container.Name,
			State:          container.State,
			Image:          container.Image,
			Labels:         container.Labels,
			Networks:       networks,
			PublishedPorts: append([]int(nil), container.PublishedPorts...),
		})
	}

	return containers, nil
}

func (f *fakeDocker) ConnectNetwork(_ context.Context, network, containerID, alias string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.connectErr != nil {
		return f.connectErr
	}

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	container.Networks[network] = alias

	return nil
}

func (f *fakeDocker) StopContainer(_ context.Context, containerID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	container.State = "exited"
	f.stopped = append(f.stopped, containerID)

	return nil
}

func (f *fakeDocker) StartContainer(_ context.Context, containerID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	container.State = "running"

	return nil
}

func (f *fakeDocker) RestartContainer(_ context.Context, containerID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	container.State = "running"

	return nil
}

func (f *fakeDocker) RemoveContainer(_ context.Context, containerID string, _ bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.removeErr != nil {
		return f.removeErr
	}

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	delete(f.containers, container.ID)
	f.removed = append(f.removed, container.ID)

	return nil
}

func (f *fakeDocker) RenameContainer(_ context.Context, containerID, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.renameErr != nil {
		return f.renameErr
	}

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	if other, exists := f.find(name); exists && other.ID != container.ID {
		return fmt.Errorf("container name %q is already in use", name)
	}
	container.Name = name
	f.renamed[container.ID] = name

	return nil
}

func (f *fakeDocker) Probe(_ context.Context, containerID, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.probeCalls++
	if f.exitedAfterProbe {
		if container, ok := f.find(containerID); ok {
			container.State = "exited"
		}
	}
	if f.probeErr != nil && f.probeCalls > f.probeErrAfter {
		return f.probeErr
	}

	return nil
}

// Exec records the command it was asked to run. `pg_isready` succeeds unless the
// test injects an error, which is how readiness and rotation are exercised.
func (f *fakeDocker) Exec(
	_ context.Context,
	containerID string,
	command []string,
	stdin string,
) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if _, ok := f.find(containerID); !ok {
		return "", fmt.Errorf("no such container: %s", containerID)
	}
	f.execCalls = append(f.execCalls, fakeExec{
		ContainerID: containerID,
		Command:     append([]string(nil), command...),
		Stdin:       stdin,
	})
	if f.execErr != nil {
		return "", f.execErr
	}

	return "accepting connections", nil
}

func (f *fakeDocker) Logs(
	_ context.Context,
	containerID string,
	_ int,
	_ bool,
	onLine func(time.Time, string),
) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	container, ok := f.find(containerID)
	if !ok {
		return fmt.Errorf("no such container: %s", containerID)
	}
	for _, line := range container.Logs {
		onLine(time.Now(), line)
	}

	return nil
}

func (f *fakeDocker) RemoveImage(_ context.Context, imageRef string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.imageErr != nil {
		return f.imageErr
	}
	if _, ok := f.images[imageRef]; !ok {
		return fmt.Errorf("no such image: %s", imageRef)
	}
	delete(f.images, imageRef)

	return nil
}

func (f *fakeDocker) ListImages(_ context.Context, repositoryPrefix string) ([]ImageInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	var images []ImageInfo
	for ref, createdAt := range f.images {
		if strings.HasPrefix(ref, repositoryPrefix) {
			images = append(images, ImageInfo{Ref: ref, CreatedAt: createdAt})
		}
	}

	return images, nil
}

func (f *fakeDocker) PruneBuildCache(_ context.Context, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.pruneCalls++
	if f.pruneErr != nil {
		return f.pruneErr
	}

	return nil
}

func (f *fakeDocker) EnsureVolume(_ context.Context, spec VolumeSpec) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.volumeErr != nil {
		return f.volumeErr
	}
	if volume, ok := f.volumes[spec.Name]; ok {
		// Docker's `volume create` on an existing Volume returns it untouched,
		// so a redeploy never replaces the data or rewrites the labels.
		_ = volume
		return nil
	}
	f.volumes[spec.Name] = &fakeVolume{Name: spec.Name, Labels: spec.Labels}

	return nil
}

func (f *fakeDocker) VolumeUsage(_ context.Context, name string) (int64, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	volume, ok := f.volumes[name]
	if !ok {
		return 0, false, nil
	}

	return volume.UsageMB, true, nil
}

func (f *fakeDocker) ContainerStats(_ context.Context, containerID string) (ContainerStats, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	return f.stats[containerID], nil
}

func (f *fakeDocker) DumpDatabase(
	_ context.Context,
	containerName, databaseName, username, destPath string,
) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.dumpErr != nil {
		return f.dumpErr
	}
	f.dumped = append(f.dumped, containerName+" "+databaseName+" "+username)

	return os.WriteFile(destPath, []byte("custom-format-dump"), 0o600)
}

func (f *fakeDocker) ArchiveVolume(_ context.Context, volumeName, destPath string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.archiveErr != nil {
		return f.archiveErr
	}
	f.archived = append(f.archived, volumeName)

	return os.WriteFile(destPath, []byte("compressed-tar"), 0o600)
}

func (f *fakeDocker) RemoveVolume(_ context.Context, name string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.volumeErr != nil {
		return false, f.volumeErr
	}
	if _, ok := f.volumes[name]; !ok {
		return false, nil
	}
	delete(f.volumes, name)

	return true, nil
}

func (f *fakeDocker) WriteVolumeFiles(_ context.Context, volumeName string, files []VolumeFile) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.writeErr != nil {
		return f.writeErr
	}
	if _, ok := f.volumes[volumeName]; !ok {
		return fmt.Errorf("no such volume: %s", volumeName)
	}
	if f.volumeFiles[volumeName] == nil {
		f.volumeFiles[volumeName] = make(map[string]string)
	}
	for _, file := range files {
		f.volumeFiles[volumeName][file.Name] = file.Content
	}

	return nil
}

func (f *fakeDocker) ListVolumes(_ context.Context, labels map[string]string) ([]VolumeInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	var volumes []VolumeInfo
	for _, volume := range f.volumes {
		if !matchesLabels(volume.Labels, labels) {
			continue
		}
		volumes = append(volumes, VolumeInfo{Name: volume.Name, Labels: volume.Labels})
	}

	return volumes, nil
}

// find resolves a container by id or name, the way the docker CLI does.
func (f *fakeDocker) find(reference string) (*fakeContainer, bool) {
	if container, ok := f.containers[reference]; ok {
		return container, true
	}
	for _, container := range f.containers {
		if container.Name == reference {
			return container, true
		}
	}

	return nil, false
}

func matchesLabels(labels, want map[string]string) bool {
	for key, value := range want {
		if labels[key] != value {
			return false
		}
	}

	return true
}

// fakeRouter records the routes the Manager programmed.
type fakeRouter struct {
	mu     sync.Mutex
	routes map[string]Route
	putErr error
}

func newFakeRouter() *fakeRouter {
	return &fakeRouter{routes: make(map[string]Route)}
}

func (f *fakeRouter) PutRoute(_ context.Context, route Route) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.putErr != nil {
		return f.putErr
	}
	f.routes[route.Hostname] = route

	return nil
}

func (f *fakeRouter) DeleteRoute(_ context.Context, hostname string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	delete(f.routes, hostname)

	return nil
}

func (f *fakeRouter) ListRoutes(_ context.Context) ([]Route, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	routes := make([]Route, 0, len(f.routes))
	for _, route := range f.routes {
		routes = append(routes, route)
	}

	return routes, nil
}

// route returns the route for a hostname and whether it exists.
func (f *fakeRouter) route(hostname string) (Route, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()

	route, ok := f.routes[hostname]

	return route, ok
}

// testManager returns a Manager wired to fakes with a short health check so the
// tests run quickly without changing the production limit.
func testManager(t *testing.T, docker *fakeDocker, router *fakeRouter) *Manager {
	t.Helper()

	manager := NewManager(docker, router)
	manager.healthTimeout = 50 * time.Millisecond
	manager.pollInterval = time.Millisecond

	return manager
}

func sampleRequest() DeployRequest {
	return DeployRequest{
		DeploymentID:   "deployment-1",
		ServiceID:      "service-1",
		ProjectID:      "project-1",
		OrganizationID: "org-1",
		Hostname:       "web-abc123.127.0.0.1.nip.io",
		ImageRef:       "stealth/service-1:deployment-1",
		ContainerPort:  3000,
		HealthPath:     "/health",
		CPULimit:       0.5,
		MemoryLimitMB:  512,
		Environment:    map[string]string{"DATABASE_URL": "postgres://private"},
	}
}

func TestDeployRunsContainerWithLimitsAndHardening(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	result, err := manager.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "running" {
		t.Fatalf("expected a running deployment, got %q (%s)", result.Status, result.Error)
	}

	if len(docker.created) != 1 {
		t.Fatalf("expected one container, got %d", len(docker.created))
	}
	spec := docker.created[0]

	if spec.CPU != 0.5 || spec.MemoryMB != 512 {
		t.Fatalf("expected 0.5 vCPU and 512 MB, got %v vCPU and %d MB", spec.CPU, spec.MemoryMB)
	}
	if !spec.ReadOnlyRoot {
		t.Fatal("expected a read-only root filesystem")
	}
	if spec.Network != "stealth-project-project-1" {
		t.Fatalf("expected the Project network, got %q", spec.Network)
	}
	if spec.Environment["DATABASE_URL"] != "postgres://private" {
		t.Fatalf("expected the environment variable to reach the container, got %v", spec.Environment)
	}

	for key, want := range map[string]string{
		LabelType:           ResourceTypeService,
		LabelOrganizationID: "org-1",
		LabelProjectID:      "project-1",
		LabelServiceID:      "service-1",
		LabelDeploymentID:   "deployment-1",
		LabelHostname:       "web-abc123.127.0.0.1.nip.io",
		LabelPort:           "3000",
	} {
		if spec.Labels[key] != want {
			t.Fatalf("expected label %s=%q, got %q", key, want, spec.Labels[key])
		}
	}

	// The promoted container must hold the stable name so a Stop finds it.
	if _, ok := docker.find("stealth-svc-service-1"); !ok {
		t.Fatal("expected the container to be renamed to the stable Service name")
	}

	route, ok := router.route("web-abc123.127.0.0.1.nip.io")
	if !ok {
		t.Fatal("expected the route to be programmed")
	}
	if route.Upstream != spec.Labels[LabelAlias]+":3000" {
		t.Fatalf("expected the route to dial the container alias, got %q", route.Upstream)
	}
}

func TestDeployReplacesTheOldContainerAfterHealthPasses(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("first deploy: %v", err)
	}

	second := sampleRequest()
	second.DeploymentID = "deployment-2"
	second.ImageRef = "stealth/service-1:deployment-2"

	result, err := manager.Deploy(context.Background(), second)
	if err != nil {
		t.Fatalf("second deploy: %v", err)
	}
	if result.Status != "running" {
		t.Fatalf("expected the second deployment to run, got %q (%s)", result.Status, result.Error)
	}

	if len(docker.stopped) != 1 {
		t.Fatalf("expected the old container to be stopped once, got %v", docker.stopped)
	}
	if len(docker.removed) != 1 {
		t.Fatalf("expected the old container to be removed once, got %v", docker.removed)
	}

	route, _ := router.route("web-abc123.127.0.0.1.nip.io")
	if want := deploymentAlias(second.ServiceID, second.DeploymentID); !strings.Contains(route.Upstream, want) {
		t.Fatalf("expected the route to dial the new container alias %q, got %q", want, route.Upstream)
	}
}

func TestDeployKeepsTheOldContainerWhenHealthCheckFails(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("first deploy: %v", err)
	}
	before, _ := router.route("web-abc123.127.0.0.1.nip.io")

	docker.probeErr = errors.New("wget: connection refused")
	second := sampleRequest()
	second.DeploymentID = "deployment-2"

	result, err := manager.Deploy(context.Background(), second)
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "failed" {
		t.Fatalf("expected a failed deployment, got %q", result.Status)
	}
	if result.Error == "" {
		t.Fatal("expected an error message explaining the health check failure")
	}

	// The previously running container must still be serving.
	if _, ok := docker.find("stealth-svc-service-1"); !ok {
		t.Fatal("expected the old container to keep running")
	}
	if len(docker.stopped) != 0 {
		t.Fatalf("expected the old container not to be stopped, got %v", docker.stopped)
	}

	after, ok := router.route("web-abc123.127.0.0.1.nip.io")
	if !ok {
		t.Fatal("expected the old route to stay in place")
	}
	if after.Upstream != before.Upstream {
		t.Fatalf("expected the route to keep pointing at the old container, got %q", after.Upstream)
	}

	// The unhealthy candidate must be gone.
	if len(docker.created) != 2 {
		t.Fatalf("expected two containers to be attempted, got %d", len(docker.created))
	}
}

func TestFirstDeployFailsWhenTheContainerNeverBecomesHealthy(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	docker.probeErr = errors.New("wget: connection refused")

	result, err := manager.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "failed" {
		t.Fatalf("expected a failed deployment, got %q", result.Status)
	}
	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); ok {
		t.Fatal("expected no route for a Service that never became healthy")
	}
	if len(docker.removed) != 1 {
		t.Fatalf("expected the unhealthy container to be removed, got %v", docker.removed)
	}
}

func TestDeployStopsWaitingWhenTheContainerExits(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	docker.probeErr = errors.New("connection refused")
	docker.exitedAfterProbe = true

	started := time.Now()
	result, err := manager.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "failed" {
		t.Fatalf("expected a failed deployment, got %q", result.Status)
	}
	if elapsed := time.Since(started); elapsed > manager.healthTimeout {
		t.Fatalf("expected the exited container to fail fast, waited %s", elapsed)
	}
	if !strings.Contains(result.Error, "exited") {
		t.Fatalf("expected the error to mention the exit, got %q", result.Error)
	}
}

func TestDeployIsIdempotent(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	first, err := manager.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("first deploy: %v", err)
	}
	second, err := manager.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("second deploy: %v", err)
	}

	if first.ContainerID != second.ContainerID {
		t.Fatalf("expected the same container, got %q and %q", first.ContainerID, second.ContainerID)
	}
	if len(docker.created) != 1 {
		t.Fatalf("expected one container, got %d", len(docker.created))
	}
}

func TestDeployRetryAfterRestartFindsTheRunningContainer(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()

	if _, err := testManager(t, docker, router).Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("first deploy: %v", err)
	}

	// A fresh Manager has no memory of the Deployment, which is what an agent
	// restart looks like. The container labels must be enough.
	restarted := testManager(t, docker, router)
	result, err := restarted.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if result.Status != "running" {
		t.Fatalf("expected the retry to report running, got %q", result.Status)
	}
	if len(docker.created) != 1 {
		t.Fatalf("expected no second container, got %d", len(docker.created))
	}
}

func TestStopRemovesTheRouteAndKeepsTheContainer(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	state, err := manager.Stop(context.Background(), "service-1")
	if err != nil {
		t.Fatalf("stop: %v", err)
	}
	if state.Status != "stopped" {
		t.Fatalf("expected the Service to be stopped, got %q", state.Status)
	}
	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); ok {
		t.Fatal("expected the route to be withdrawn while stopped")
	}
	if _, ok := docker.find("stealth-svc-service-1"); !ok {
		t.Fatal("expected the container to be kept so its data survives")
	}
}

func TestStartRestoresTheRouteWithoutRecreatingTheContainer(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if _, err := manager.Stop(context.Background(), "service-1"); err != nil {
		t.Fatalf("stop: %v", err)
	}

	state, err := manager.Start(context.Background(), "service-1")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if state.Status != "running" {
		t.Fatalf("expected the Service to be running, got %q", state.Status)
	}
	if len(docker.created) != 1 {
		t.Fatalf("expected the same container to be reused, got %d containers", len(docker.created))
	}

	route, ok := router.route("web-abc123.127.0.0.1.nip.io")
	if !ok {
		t.Fatal("expected the route to be restored")
	}
	if !strings.HasSuffix(route.Upstream, ":3000") {
		t.Fatalf("expected the route to dial the container port, got %q", route.Upstream)
	}
}

func TestRestartKeepsTheRoute(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	state, err := manager.Restart(context.Background(), "service-1")
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	if state.Status != "running" {
		t.Fatalf("expected the Service to be running, got %q", state.Status)
	}
	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); !ok {
		t.Fatal("expected the route to stay in place across a restart")
	}
	if len(docker.created) != 1 {
		t.Fatalf("expected no new container, got %d", len(docker.created))
	}
}

func TestLifecycleOnAnUnknownServiceReportsAbsent(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	state, err := manager.State(context.Background(), "service-1")
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if state.Status != "absent" {
		t.Fatalf("expected an absent Service, got %q", state.Status)
	}

	if _, err := manager.Stop(context.Background(), "service-1"); !errors.Is(err, ErrUnknownService) {
		t.Fatalf("expected ErrUnknownService from Stop, got %v", err)
	}
	if _, err := manager.Start(context.Background(), "service-1"); !errors.Is(err, ErrUnknownService) {
		t.Fatalf("expected ErrUnknownService from Start, got %v", err)
	}
	if err := manager.Logs(context.Background(), "service-1", 10, false, func(time.Time, string) {}); !errors.Is(err, ErrUnknownService) {
		t.Fatalf("expected ErrUnknownService from Logs, got %v", err)
	}
}

func TestRemoveDeletesTheContainerAndItsRoute(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	state, err := manager.Remove(context.Background(), "service-1")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if state.Status != "absent" {
		t.Fatalf("expected the Service to be absent, got %q", state.Status)
	}
	if _, ok := docker.find("stealth-svc-service-1"); ok {
		t.Fatal("expected the container to be removed")
	}
	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); ok {
		t.Fatal("expected the route to be removed")
	}
}

func TestReconcileRestoresRoutesAndDropsStaleOnes(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()

	// A container that outlived the agent: running, labelled, but not attached
	// to its Project network and with no route.
	docker.containers["container-1"] = &fakeContainer{
		ID:    "container-1",
		Name:  "stealth-svc-service-1",
		State: "running",
		Labels: map[string]string{
			LabelType:         ResourceTypeService,
			LabelServiceID:    "service-1",
			LabelProjectID:    "project-1",
			LabelDeploymentID: "deployment-1",
			LabelHostname:     "web-abc123.127.0.0.1.nip.io",
			LabelPort:         "3000",
			LabelAlias:        "svc-service-1-deployment-1",
		},
		Networks: map[string]string{},
	}

	// A route whose Service no longer exists must be withdrawn.
	router.routes["gone-abc.127.0.0.1.nip.io"] = Route{
		Hostname: "gone-abc.127.0.0.1.nip.io",
		Upstream: "svc-gone-deployment-9:3000",
	}

	manager := testManager(t, docker, router)
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	container, _ := docker.find("container-1")
	if _, ok := container.Networks["stealth-project-project-1"]; !ok {
		t.Fatal("expected the container to be re-attached to the Project network")
	}

	route, ok := router.route("web-abc123.127.0.0.1.nip.io")
	if !ok {
		t.Fatal("expected the route to be restored from the container labels")
	}
	if route.Upstream != "svc-service-1-deployment-1:3000" {
		t.Fatalf("expected the route to dial the container alias, got %q", route.Upstream)
	}

	if _, ok := router.route("gone-abc.127.0.0.1.nip.io"); ok {
		t.Fatal("expected the stale route to be removed")
	}
}

func TestReconcileLeavesStoppedServicesWithoutARoute(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()

	docker.containers["container-1"] = &fakeContainer{
		ID:    "container-1",
		Name:  "stealth-svc-service-1",
		State: "exited",
		Labels: map[string]string{
			LabelType:      ResourceTypeService,
			LabelServiceID: "service-1",
			LabelProjectID: "project-1",
			LabelHostname:  "web-abc123.127.0.0.1.nip.io",
			LabelPort:      "3000",
			LabelAlias:     "svc-service-1-deployment-1",
		},
		Networks: map[string]string{"stealth-project-project-1": "svc-service-1-deployment-1"},
	}

	manager := testManager(t, docker, router)
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); ok {
		t.Fatal("expected a stopped Service to have no route")
	}
}

func TestReconcileIgnoresLeftoverCandidates(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()

	docker.containers["container-1"] = &fakeContainer{
		ID:    "container-1",
		Name:  "stealth-svc-service-1-candidate",
		State: "running",
		Labels: map[string]string{
			LabelType:      ResourceTypeService,
			LabelServiceID: "service-1",
			LabelProjectID: "project-1",
			LabelHostname:  "web-abc123.127.0.0.1.nip.io",
			LabelPort:      "3000",
			LabelAlias:     "svc-service-1-deployment-2",
		},
		Networks: map[string]string{"stealth-project-project-1": "svc-service-1-deployment-2"},
	}

	manager := testManager(t, docker, router)
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); ok {
		t.Fatal("expected a leftover candidate not to receive traffic")
	}
}

func TestDeployRejectsIncompleteRequests(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	cases := map[string]func(*DeployRequest){
		"no deployment id": func(r *DeployRequest) { r.DeploymentID = "" },
		"no service id":    func(r *DeployRequest) { r.ServiceID = "" },
		"no project id":    func(r *DeployRequest) { r.ProjectID = "" },
		"no image":         func(r *DeployRequest) { r.ImageRef = "" },
		"no hostname":      func(r *DeployRequest) { r.Hostname = "" },
		"bad port":         func(r *DeployRequest) { r.ContainerPort = 0 },
		"no memory limit":  func(r *DeployRequest) { r.MemoryLimitMB = 0 },
		"no cpu limit":     func(r *DeployRequest) { r.CPULimit = 0 },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			request := sampleRequest()
			mutate(&request)

			if _, err := manager.Deploy(context.Background(), request); !errors.Is(err, ErrInvalidDeploy) {
				t.Fatalf("expected ErrInvalidDeploy, got %v", err)
			}
		})
	}
}

func TestDeployReportsAFailedRouteUpdate(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	router.putErr = errors.New("caddy is down")
	manager := testManager(t, docker, router)

	result, err := manager.Deploy(context.Background(), sampleRequest())
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "failed" {
		t.Fatalf("expected a failed deployment, got %q", result.Status)
	}
	if !strings.Contains(result.Error, "route") {
		t.Fatalf("expected the error to mention the route, got %q", result.Error)
	}
	if len(docker.removed) != 1 {
		t.Fatalf("expected the candidate to be removed, got %v", docker.removed)
	}
}

func TestProbeScriptChecksPortThenHealthPath(t *testing.T) {
	script := probeScript(3000, "/health")

	for _, want := range []string{"127.0.0.1 3000", "http://127.0.0.1:3000/health", "nc -z"} {
		if !strings.Contains(script, want) {
			t.Fatalf("expected the probe script to contain %q, got %q", want, script)
		}
	}
}

func TestProbeScriptExplainsWhyItFailed(t *testing.T) {
	script := probeScript(3000, "/health")

	// The Deployment error is the only diagnostic the user sees, so the probe
	// must say which step failed instead of exiting silently.
	for _, want := range []string{"nothing is listening on port 3000", "GET /health"} {
		if !strings.Contains(script, want) {
			t.Fatalf("expected the probe script to explain %q, got %q", want, script)
		}
	}
}

func TestDeploymentAliasFitsInOneDNSLabel(t *testing.T) {
	// Docker's embedded DNS cannot answer for a label longer than 63 characters,
	// and a Service or Deployment id alone is already a 36 character UUID. This
	// is the regression that made Caddy fail with "no such host" in production.
	alias := deploymentAlias(
		"93dada06-3b2e-4228-a8f3-4ca76c8807b0",
		"0b88815a-7ad1-4e38-a2ea-907971efa741",
	)

	if len(alias) > 63 {
		t.Fatalf("expected the alias to fit in one DNS label, got %d characters: %s", len(alias), alias)
	}
	if alias != strings.ToLower(alias) {
		t.Fatalf("expected a lowercase alias so DNS is case insensitive, got %q", alias)
	}
}

func TestDeploymentAliasIsUniquePerDeployment(t *testing.T) {
	first := deploymentAlias("service-1", "deployment-1")
	second := deploymentAlias("service-1", "deployment-2")
	other := deploymentAlias("service-2", "deployment-1")

	if first == second {
		t.Fatalf("expected two Deployments to get different aliases, both were %q", first)
	}
	if first == other {
		t.Fatalf("expected two Services to get different aliases, both were %q", first)
	}
	if first != deploymentAlias("service-1", "deployment-1") {
		t.Fatal("expected the alias to be stable for the same Deployment")
	}
}

func TestProbeScriptDefaultsToRootPath(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	request := sampleRequest()
	request.HealthPath = ""
	if err := manager.waitHealthy(context.Background(), "container-1", request); err != nil {
		t.Fatalf("waitHealthy: %v", err)
	}
}

func TestSplitTimestampKeepsTheContainerWriteTime(t *testing.T) {
	writtenAt, message := splitTimestamp("2026-11-08T02:22:54.828747716Z Server started!")

	if message != "Server started!" {
		t.Fatalf("expected the message without the timestamp prefix, got %q", message)
	}
	if writtenAt.Year() != 2026 || writtenAt.Month() != time.November || writtenAt.Day() != 8 {
		t.Fatalf("expected the container's own timestamp, got %s", writtenAt)
	}
}

func TestSplitTimestampPassesThroughUnstampedLines(t *testing.T) {
	// A line without a prefix must still be delivered, otherwise output would be
	// silently dropped when the format changes.
	_, message := splitTimestamp("Server started!")

	if message != "Server started!" {
		t.Fatalf("expected the line to pass through unchanged, got %q", message)
	}
}

func TestLogsForwardsContainerOutput(t *testing.T) {
	docker := newFakeDocker()
	docker.containers["container-1"] = &fakeContainer{
		ID:    "container-1",
		Name:  "stealth-svc-service-1",
		State: "running",
		Logs:  []string{"listening on 3000", "ready"},
	}
	manager := testManager(t, docker, newFakeRouter())

	var lines []string
	err := manager.Logs(context.Background(), "service-1", 100, false, func(_ time.Time, line string) {
		lines = append(lines, line)
	})
	if err != nil {
		t.Fatalf("logs: %v", err)
	}

	if len(lines) != 2 {
		t.Fatalf("expected two log lines, got %v", lines)
	}
}

// volumeRequest returns sampleRequest with a Volume mounted at /data.
func volumeRequest() DeployRequest {
	request := sampleRequest()
	request.Volume = &VolumeMount{
		Name:      "stealth-vol-service-1",
		MountPath: "/data",
		SizeMB:    MaxVolumeSizeMB,
	}

	return request
}

func TestDeployCreatesTheVolumeAndMountsIt(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	result, err := manager.Deploy(context.Background(), volumeRequest())
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "running" {
		t.Fatalf("expected a running deployment, got %q (%s)", result.Status, result.Error)
	}

	volume, ok := docker.volumes["stealth-vol-service-1"]
	if !ok {
		t.Fatal("expected the Volume to be created before the container starts")
	}
	for key, want := range map[string]string{
		LabelType:           ResourceTypeVolume,
		LabelOrganizationID: "org-1",
		LabelProjectID:      "project-1",
		LabelServiceID:      "service-1",
		LabelDeploymentID:   "deployment-1",
	} {
		if volume.Labels[key] != want {
			t.Fatalf("expected Volume label %s=%q, got %q", key, want, volume.Labels[key])
		}
	}

	spec := docker.created[0]
	if spec.Volume == nil || spec.Volume.Name != "stealth-vol-service-1" || spec.Volume.MountPath != "/data" {
		t.Fatalf("expected the Volume to be mounted at /data, got %+v", spec.Volume)
	}
	for key, want := range map[string]string{
		LabelVolumeName:   "stealth-vol-service-1",
		LabelVolumePath:   "/data",
		LabelVolumeSizeMb: "1024",
	} {
		if spec.Labels[key] != want {
			t.Fatalf("expected container label %s=%q, got %q", key, want, spec.Labels[key])
		}
	}
}

func TestDeployKeepsAnExistingVolumeInsteadOfReplacingIt(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	// A previous Deployment already wrote data; the Volume carries its usage.
	docker.volumes["stealth-vol-service-1"] = &fakeVolume{
		Name:    "stealth-vol-service-1",
		Labels:  map[string]string{LabelType: ResourceTypeVolume, LabelServiceID: "service-1"},
		UsageMB: 40,
	}

	if _, err := manager.Deploy(context.Background(), volumeRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if usage := docker.volumes["stealth-vol-service-1"].UsageMB; usage != 40 {
		t.Fatalf("expected the existing data to survive, usage became %d MB", usage)
	}
}

func TestDeployFailsWhenTheVolumeIsAlreadyOverItsLimit(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	docker.volumes["stealth-vol-service-1"] = &fakeVolume{
		Name:    "stealth-vol-service-1",
		Labels:  map[string]string{LabelType: ResourceTypeVolume, LabelServiceID: "service-1"},
		UsageMB: MaxVolumeSizeMB + 1,
	}

	result, err := manager.Deploy(context.Background(), volumeRequest())
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "failed" {
		t.Fatalf("expected the Deployment to fail, got %q", result.Status)
	}
	if !strings.Contains(result.Error, "over its") {
		t.Fatalf("expected an over-quota reason, got %q", result.Error)
	}
	if len(docker.created) != 0 {
		t.Fatal("expected no container to start when the Volume is over quota")
	}
}

func TestEnsureVolumeIsIdempotentAndReportsUsage(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	request := VolumeRequest{
		Name:           "stealth-vol-service-1",
		ServiceID:      "service-1",
		ProjectID:      "project-1",
		OrganizationID: "org-1",
		DeploymentID:   "deployment-1",
		SizeMB:         1024,
	}
	state, err := manager.EnsureVolume(context.Background(), request)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if !state.Exists || state.SizeMB != 1024 || state.UsageMB != 0 {
		t.Fatalf("unexpected Volume state: %+v", state)
	}

	docker.volumes["stealth-vol-service-1"].UsageMB = 12
	again, err := manager.EnsureVolume(context.Background(), request)
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if again.UsageMB != 12 {
		t.Fatalf("expected the usage to be reported, got %d MB", again.UsageMB)
	}
}

func TestGetVolumeReportsAMissingVolume(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	state, err := manager.GetVolume(context.Background(), "stealth-vol-service-1", 1024)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if state.Exists {
		t.Fatal("expected a Volume that was never created to report exists=false")
	}
}

func TestRemoveDeletesTheServiceVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.Deploy(context.Background(), volumeRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if _, ok := docker.volumes["stealth-vol-service-1"]; !ok {
		t.Fatal("expected the Volume to exist after the deploy")
	}

	if _, err := manager.Remove(context.Background(), "service-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, ok := docker.volumes["stealth-vol-service-1"]; ok {
		t.Fatal("expected the Volume to be removed with the Service")
	}
}

func TestEnforceVolumesStopsAnOverQuotaContainer(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.Deploy(context.Background(), volumeRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}
	docker.volumes["stealth-vol-service-1"].UsageMB = MaxVolumeSizeMB + 10

	stopped, err := manager.EnforceVolumes(context.Background())
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	if stopped != 1 {
		t.Fatalf("expected one container to be stopped, got %d", stopped)
	}
	if container, _ := docker.find("stealth-svc-service-1"); container.State != "exited" {
		t.Fatalf("expected the container to be stopped, got %q", container.State)
	}
}

func TestEnforceVolumesLeavesAContainerUnderItsLimitAlone(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.Deploy(context.Background(), volumeRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}
	docker.volumes["stealth-vol-service-1"].UsageMB = MaxVolumeSizeMB - 1

	stopped, err := manager.EnforceVolumes(context.Background())
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	if stopped != 0 {
		t.Fatalf("expected nothing to be stopped, got %d", stopped)
	}
	if container, _ := docker.find("stealth-svc-service-1"); container.State != "running" {
		t.Fatalf("expected the container to keep running, got %q", container.State)
	}
}

func TestCleanupRemovesOrphanVolumesOnly(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetCleanupStatePath(filepath.Join(t.TempDir(), "cleanup.json"))

	// A live Service keeps its Volume.
	docker.containers["container-1"] = &fakeContainer{
		ID:       "container-1",
		Name:     "stealth-svc-service-1",
		State:    "running",
		Labels:   map[string]string{LabelType: ResourceTypeService, LabelServiceID: "service-1"},
		Networks: map[string]string{},
	}
	docker.volumes["stealth-vol-service-1"] = &fakeVolume{
		Name:   "stealth-vol-service-1",
		Labels: map[string]string{LabelType: ResourceTypeVolume, LabelServiceID: "service-1"},
	}
	// A Volume whose Service is gone must be removed.
	docker.volumes["stealth-vol-service-2"] = &fakeVolume{
		Name:   "stealth-vol-service-2",
		Labels: map[string]string{LabelType: ResourceTypeVolume, LabelServiceID: "service-2"},
	}

	report, err := manager.Cleanup(context.Background())
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if report.VolumesRemoved != 1 {
		t.Fatalf("expected one orphan Volume to be removed, got %d", report.VolumesRemoved)
	}
	if _, ok := docker.volumes["stealth-vol-service-1"]; !ok {
		t.Fatal("expected the live Service Volume to survive")
	}
	if _, ok := docker.volumes["stealth-vol-service-2"]; ok {
		t.Fatal("expected the orphan Volume to be gone")
	}
}

func TestVolumeRequestsAreValidated(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	cases := map[string]VolumeRequest{
		"bad name":       {Name: "not a name", ServiceID: "service-1", ProjectID: "project-1", OrganizationID: "org-1", SizeMB: 1024},
		"missing owner":  {Name: "stealth-vol-1", ProjectID: "project-1", OrganizationID: "org-1", SizeMB: 1024},
		"size too small": {Name: "stealth-vol-1", ServiceID: "service-1", ProjectID: "project-1", OrganizationID: "org-1", SizeMB: 0},
		"size too large": {Name: "stealth-vol-1", ServiceID: "service-1", ProjectID: "project-1", OrganizationID: "org-1", SizeMB: MaxVolumeSizeMB + 1},
	}
	for name, request := range cases {
		if _, err := manager.EnsureVolume(context.Background(), request); !errors.Is(err, ErrInvalidDeploy) {
			t.Fatalf("%s: expected ErrInvalidDeploy, got %v", name, err)
		}
	}
}
