// Package runtime runs a built image as a Service container and manages the
// Caddy route in front of it. Everything here talks to Docker and Caddy through
// the exec.Executor seam, so the real Docker and Caddy are exercised by the
// tests instead of a mock of the platform's own logic.
package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"stealth/agent/internal/exec"
)

// Labels the Node Agent puts on every container it owns. Reconcile reads these
// back after a restart, so the platform can rebuild its view without a database
// on the node.
const (
	LabelType           = "stealth.type"
	LabelOrganizationID = "stealth.organizationId"
	LabelProjectID      = "stealth.projectId"
	LabelServiceID      = "stealth.serviceId"
	LabelDeploymentID   = "stealth.deploymentId"
	LabelHostname       = "stealth.hostname"
	// LabelPort and LabelAlias are recorded on the container so Start and
	// reconcile can rebuild the Caddy route without reading the Service row.
	LabelPort  = "stealth.port"
	LabelAlias = "stealth.alias"

	// Volume labels let the agent find a Service's Volume after a restart
	// without the Control Plane, and keep every Volume attributable to its owner.
	LabelVolumeName   = "stealth.volumeName"
	LabelVolumePath   = "stealth.volumePath"
	LabelVolumeSizeMb = "stealth.volumeSizeMb"

	// Database labels let the agent find a Project Database after a restart,
	// measure its storage, and run `pg_isready` without asking the Control Plane.
	LabelDatabaseID        = "stealth.databaseId"
	LabelDatabaseName      = "stealth.databaseName"
	LabelDatabaseUsername  = "stealth.databaseUsername"
	LabelDatabaseStorageMb = "stealth.databaseStorageMb"
	// The public proxy labels record the port and allowlist on the container, so
	// the agent can report and reuse them after a restart.
	LabelDatabaseProxyPort      = "stealth.databaseProxyPort"
	LabelDatabaseProxyAllowlist = "stealth.databaseProxyAllowlist"
	ResourceTypeService         = "service"
	ResourceTypeVolume          = "volume"
	ResourceTypeDatabase        = "database"
	ResourceTypeDatabaseProxy   = "database-proxy"
)

// ContainerSpec is one Service container the agent wants running.
type ContainerSpec struct {
	// Name is the Docker container name.
	Name string
	// Network and NetworkAlias place the container on the Project network under
	// the name the route dials. The alias is unique per Deployment, so a new
	// container never shares a name with the one still serving traffic.
	Network      string
	NetworkAlias string
	Image        string
	Port         int
	CPU          float64
	MemoryMB     int
	// User overrides the image's default user. The Database runs as the
	// `postgres` user so its entrypoint never needs root capabilities.
	User string
	// Entrypoint overrides the image entrypoint and Command appends arguments
	// after the image name. The public Database proxy uses both to run nginx with
	// its generated configuration instead of the image's default entrypoint.
	Entrypoint  string
	Command     []string
	Environment map[string]string
	// PublishedPort, when set, publishes the container Port on the host. Only the
	// public Database proxy uses it; a Database itself never publishes a port.
	PublishedPort int
	// Volume is the Service's persistent Volume, mounted at MountPath. Nil
	// means the Service has no Volume.
	Volume *VolumeMount
	Labels map[string]string
	// ReadOnlyRoot keeps the container filesystem immutable; /tmp is a tmpfs.
	ReadOnlyRoot bool
}

// VolumeFile is one file the agent writes into a named Volume before starting a
// container that reads it. The public proxy uses it for its nginx configuration,
// and the Database uses it for its TLS material. Owner is the `uid:gid` the
// files must belong to, because the containers run unprivileged.
type VolumeFile struct {
	Name    string
	Content string
	Mode    os.FileMode
	Owner   string
}

// VolumeMount is a named Docker Volume at a path inside the container.
type VolumeMount struct {
	Name      string
	MountPath string
	SizeMB    int
}

// VolumeSpec describes a Volume the agent should create or adopt.
type VolumeSpec struct {
	Name   string
	SizeMB int
	// Labels are written on creation. Docker keeps the labels forever, which is
	// what lets Cleanup find a Volume whose Service is gone.
	Labels map[string]string
}

// VolumeInfo is a Volume the agent knows about, with the labels it was created
// with.
type VolumeInfo struct {
	Name   string
	Labels map[string]string
}

// ContainerInfo is what the agent needs to know about a container.
type ContainerInfo struct {
	ID       string
	Name     string
	State    string
	Image    string
	Labels   map[string]string
	Networks []string
	// PublishedPorts are the host ports Docker publishes for the container. The
	// public proxy allocator reads them so two Databases never share a port.
	PublishedPorts []int
}

// ContainerStats is the live resource usage Docker reports for one container.
// CPUUsage is in vCPU, so 0.25 means a quarter of one core.
type ContainerStats struct {
	CPUUsage      float64
	MemoryUsageMB int64
}

// ImageInfo is one local image the cleanup considers. Ref is the repository and
// tag the agent wrote when it built the image, which is what removal needs.
type ImageInfo struct {
	ID        string
	Ref       string
	CreatedAt time.Time
}

// Running reports whether the container is currently up.
func (c ContainerInfo) Running() bool {
	return c.State == "running"
}

// OnNetwork reports whether the container is attached to the named network.
func (c ContainerInfo) OnNetwork(name string) bool {
	for _, network := range c.Networks {
		if network == name {
			return true
		}
	}

	return false
}

// Docker is the container operations the runtime needs. The CLI implementation
// is used in production and the tests substitute a fake for the manager tests.
type Docker interface {
	EnsureNetwork(ctx context.Context, name string) error
	// CreateContainer starts a detached container and returns its id.
	CreateContainer(ctx context.Context, spec ContainerSpec) (string, error)
	InspectContainer(ctx context.Context, name string) (ContainerInfo, error)
	ListContainers(ctx context.Context, labels map[string]string) ([]ContainerInfo, error)
	// ConnectNetwork attaches an existing container to a network with an alias,
	// which reconcile uses when a container lost its network attachment.
	ConnectNetwork(ctx context.Context, network, containerID, alias string) error
	StopContainer(ctx context.Context, containerID string) error
	StartContainer(ctx context.Context, containerID string) error
	RestartContainer(ctx context.Context, containerID string) error
	RemoveContainer(ctx context.Context, containerID string, force bool) error
	RenameContainer(ctx context.Context, containerID, name string) error
	// Probe runs a throwaway container sharing the target's network namespace,
	// which is the only portable way to reach a container from the host on both
	// Linux and Docker Desktop.
	Probe(ctx context.Context, targetContainerID string, script string) error
	// Logs streams the container's combined output. Each line is reported with
	// the time the container wrote it, so the dashboard shows the real order of
	// events instead of the moment the agent happened to read them.
	Logs(
		ctx context.Context,
		containerID string,
		tail int,
		follow bool,
		onLine func(writtenAt time.Time, line string),
	) error
	// RemoveImage deletes a local image. It fails when a container still uses
	// it, which is exactly the guard the cleanup needs.
	RemoveImage(ctx context.Context, imageRef string) error
	// ListImages returns the image references that match a repository prefix,
	// newest first, so the cleanup can keep only the most recent releases.
	ListImages(ctx context.Context, repositoryPrefix string) ([]ImageInfo, error)
	// PruneBuildCache drops BuildKit cache older than the given age.
	PruneBuildCache(ctx context.Context, olderThan time.Duration) error
	// EnsureVolume creates the named Volume when it is missing and applies its
	// labels. It never replaces an existing Volume, so data survives a redeploy.
	EnsureVolume(ctx context.Context, spec VolumeSpec) error
	// VolumeUsage reports how many megabytes a Volume currently uses and whether
	// the Volume exists at all. A Service can have a Volume row before its first
	// Deployment created the Volume on this node.
	VolumeUsage(ctx context.Context, name string) (int64, bool, error)
	// ContainerStats reports the live CPU and memory usage of one container.
	// Stopped containers are not sampled; the caller treats them as zero.
	ContainerStats(ctx context.Context, containerID string) (ContainerStats, error)
	// DumpDatabase writes a custom-format pg_dump of one container to destPath.
	// The container must already run PostgreSQL.
	DumpDatabase(ctx context.Context, containerName, databaseName, username, destPath string) error
	// ArchiveVolume writes a gzip compressed tar of one Volume to destPath.
	ArchiveVolume(ctx context.Context, volumeName, destPath string) error
	// RestoreDatabase replaces one Database's contents from a custom-format dump.
	// The load goes into a temporary Database and is only swapped in after it
	// succeeds, so a failed Restore leaves the original data untouched.
	RestoreDatabase(ctx context.Context, containerName, databaseName, username, srcPath string) error
	// RestoreVolume replaces one Volume's contents from a gzip compressed tar.
	// Extraction goes to a staging directory first, so a corrupt archive never
	// removes the data that was already there.
	RestoreVolume(ctx context.Context, volumeName, srcPath string) error
	// RemoveVolume deletes a Volume and its data, reporting whether it existed.
	// A missing Volume is not an error, because removal must be safe to retry.
	RemoveVolume(ctx context.Context, name string) (bool, error)
	// ListVolumes returns the Volumes that match every label, with the labels the
	// cleanup needs to decide whether their Service still exists.
	ListVolumes(ctx context.Context, labels map[string]string) ([]VolumeInfo, error)
	// WriteVolumeFiles writes files into a named Volume through a throwaway
	// container. It is how the public proxy receives its TLS certificate and
	// nginx configuration without a host bind mount.
	WriteVolumeFiles(ctx context.Context, volumeName string, files []VolumeFile) error
	// Exec runs a command inside a running container and returns its output. It
	// is how the agent asks PostgreSQL for readiness and rotates a password
	// without publishing a host port. `stdin` carries secrets so they never
	// appear in the process arguments.
	Exec(ctx context.Context, containerID string, command []string, stdin string) (string, error)
}

// CLIDocker implements Docker by shelling out to the docker CLI.
type CLIDocker struct {
	runner exec.Executor
	// probeImage must provide `nc` and `wget`; BusyBox is small and already
	// present on any node that built a BusyBox based image.
	probeImage string
}

// NewCLIDocker returns a Docker backed by the host's docker CLI.
func NewCLIDocker(runner exec.Executor, probeImage string) *CLIDocker {
	if probeImage == "" {
		probeImage = "busybox:1.36"
	}

	return &CLIDocker{runner: runner, probeImage: probeImage}
}

func (d *CLIDocker) EnsureNetwork(ctx context.Context, name string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"network", "inspect", name, "--format", "{{.Name}}"},
	})
	if err == nil {
		return nil
	}

	_, err = d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"network", "create", name},
	})

	return err
}

func (d *CLIDocker) CreateContainer(ctx context.Context, spec ContainerSpec) (string, error) {
	args := []string{
		"run", "--detach",
		"--name", spec.Name,
		"--network", spec.Network,
		"--network-alias", spec.NetworkAlias,
		// Limits come from the Service: 0.5 vCPU and 512 MB by default.
		"--cpus", strconv.FormatFloat(spec.CPU, 'f', -1, 64),
		"--memory", fmt.Sprintf("%dm", spec.MemoryMB),
		// Equal memory and memory-swap means no swap, so the limit is real.
		"--memory-swap", fmt.Sprintf("%dm", spec.MemoryMB),
		"--pids-limit", "256",
		// Hardening: no privileges, no added capabilities, no privilege gain.
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		// The agent owns the lifecycle, so Docker must not restart the container
		// behind its back.
		"--restart", "no",
		// Runtime logs are rotated by Docker so a chatty application cannot fill
		// the disk; the seven-day window itself is enforced when the log is read.
		"--log-driver", "local",
		"--log-opt", "max-size=10m",
		"--log-opt", "max-file=5",
		"--expose", strconv.Itoa(spec.Port),
	}

	if spec.PublishedPort > 0 {
		// Only the public Database proxy publishes a host port. Binding all
		// interfaces is intentional: the nginx allowlist is what decides which
		// source addresses may use it.
		args = append(args, "--publish", fmt.Sprintf("%d:%d", spec.PublishedPort, spec.Port))
	}

	if spec.Entrypoint != "" {
		args = append(args, "--entrypoint", spec.Entrypoint)
	}

	if spec.User != "" {
		// The Database image's entrypoint only chowns and drops privileges when
		// it runs as root; with all capabilities dropped it cannot, so the
		// container starts directly as the unprivileged owner of its Volume.
		args = append(args, "--user", spec.User)
	}

	if spec.ReadOnlyRoot {
		// A read-only root filesystem still needs somewhere to write; /tmp is a
		// small tmpfs with noexec and nosuid.
		args = append(args, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m")
	}

	if spec.Volume != nil {
		// The Volume is the only writable path on an otherwise immutable
		// container, and its name is stable per Service so redeploys and
		// restarts keep the same data.
		args = append(args, "--mount", fmt.Sprintf(
			"type=volume,source=%s,target=%s",
			spec.Volume.Name,
			spec.Volume.MountPath,
		))
	}

	for _, pair := range sortedPairs(spec.Labels) {
		args = append(args, "--label", pair[0]+"="+pair[1])
	}
	for _, pair := range sortedPairs(spec.Environment) {
		args = append(args, "--env", pair[0]+"="+pair[1])
	}

	args = append(args, spec.Image)
	args = append(args, spec.Command...)

	output, err := d.runner.Output(ctx, exec.Options{Name: "docker", Args: args})
	if err != nil {
		// Docker reports the reason a run failed on its own streams, but an error
		// message must never carry a secret, so any Environment Variable value the
		// message happens to echo is replaced before the error leaves the agent.
		return "", errors.New(redactEnvironment(err.Error(), spec.Environment))
	}

	return strings.TrimSpace(output), nil
}

// redactEnvironment replaces every Environment Variable value in a message with
// a placeholder. Values are passed as `--env` arguments, so a tool error that
// echoes its arguments would otherwise leak a secret into the Deployment's
// error message, the database, and the dashboard.
func redactEnvironment(message string, environment map[string]string) string {
	for _, value := range environment {
		if value == "" {
			continue
		}
		message = strings.ReplaceAll(message, value, "***")
	}

	return message
}

func (d *CLIDocker) InspectContainer(ctx context.Context, name string) (ContainerInfo, error) {
	output, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"inspect", name, "--format", "{{json .}}"},
	})
	if err != nil {
		return ContainerInfo{}, err
	}

	var raw struct {
		ID    string `json:"Id"`
		Name  string `json:"Name"`
		State struct {
			Status string `json:"Status"`
		} `json:"State"`
		Config struct {
			Labels map[string]string `json:"Labels"`
			Image  string            `json:"Image"`
		} `json:"Config"`
		NetworkSettings struct {
			Networks map[string]struct {
				IPAddress string `json:"IPAddress"`
			} `json:"Networks"`
			Ports map[string][]struct {
				HostIp   string `json:"HostIp"`
				HostPort string `json:"HostPort"`
			} `json:"Ports"`
		} `json:"NetworkSettings"`
	}
	if err := json.Unmarshal([]byte(output), &raw); err != nil {
		return ContainerInfo{}, fmt.Errorf("read container inspect output: %w", err)
	}

	info := ContainerInfo{
		ID:     raw.ID,
		Name:   strings.TrimPrefix(raw.Name, "/"),
		State:  raw.State.Status,
		Image:  raw.Config.Image,
		Labels: raw.Config.Labels,
	}
	for network := range raw.NetworkSettings.Networks {
		info.Networks = append(info.Networks, network)
	}
	sort.Strings(info.Networks)
	for _, bindings := range raw.NetworkSettings.Ports {
		for _, binding := range bindings {
			port, err := strconv.Atoi(binding.HostPort)
			if err == nil && port > 0 {
				info.PublishedPorts = append(info.PublishedPorts, port)
			}
		}
	}
	sort.Ints(info.PublishedPorts)

	return info, nil
}

func (d *CLIDocker) ListContainers(ctx context.Context, labels map[string]string) ([]ContainerInfo, error) {
	args := []string{"ps", "--all", "--format", "{{.ID}}"}
	for _, pair := range sortedPairs(labels) {
		args = append(args, "--filter", "label="+pair[0]+"="+pair[1])
	}

	output, err := d.runner.Output(ctx, exec.Options{Name: "docker", Args: args})
	if err != nil {
		return nil, err
	}

	var containers []ContainerInfo
	for _, id := range strings.Fields(output) {
		info, err := d.InspectContainer(ctx, id)
		if err != nil {
			// A container can disappear between `ps` and `inspect`; skip it
			// rather than failing the whole listing.
			continue
		}
		containers = append(containers, info)
	}

	return containers, nil
}

func (d *CLIDocker) ConnectNetwork(ctx context.Context, network, containerID, alias string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"network", "connect", "--alias", alias, network, containerID},
	})

	return err
}

func (d *CLIDocker) StopContainer(ctx context.Context, containerID string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"stop", "--time", "10", containerID},
	})

	return err
}

func (d *CLIDocker) StartContainer(ctx context.Context, containerID string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"start", containerID},
	})

	return err
}

func (d *CLIDocker) RestartContainer(ctx context.Context, containerID string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"restart", "--time", "10", containerID},
	})

	return err
}

func (d *CLIDocker) RemoveContainer(ctx context.Context, containerID string, force bool) error {
	args := []string{"rm"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, containerID)

	_, err := d.runner.Output(ctx, exec.Options{Name: "docker", Args: args})

	return err
}

func (d *CLIDocker) RenameContainer(ctx context.Context, containerID, name string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"rename", containerID, name},
	})

	return err
}

func (d *CLIDocker) Probe(ctx context.Context, targetContainerID string, script string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm",
			// Sharing the target's network namespace means 127.0.0.1 is the
			// application itself, so the probe needs no address of its own.
			"--network", "container:" + targetContainerID,
			"--entrypoint", "/bin/sh",
			d.probeImage,
			"-c", script,
		},
	})

	return err
}

func (d *CLIDocker) Logs(
	ctx context.Context,
	containerID string,
	tail int,
	follow bool,
	onLine func(writtenAt time.Time, line string),
) error {
	// `--timestamps` prefixes each line with the time the container wrote it,
	// which is the only way to get a real timestamp: `docker logs` merges stdout
	// and stderr without saying which is which, so the agent would otherwise have
	// to invent both the stream and the time.
	//
	// `--since` enforces the runtime-log retention window: a line older than the
	// window is never handed to the Control Plane, so the dashboard cannot show a
	// log the platform promised to delete.
	args := []string{
		"logs", "--timestamps",
		"--since", formatLogAge(LogRetention),
		"--tail", strconv.Itoa(tail),
	}
	if follow {
		args = append(args, "--follow")
	}
	args = append(args, containerID)

	return d.runner.Stream(ctx, exec.Options{Name: "docker", Args: args}, func(line string) {
		writtenAt, message := splitTimestamp(line)
		onLine(writtenAt, message)
	})
}

// LogRetention is how long a runtime log line stays readable. The spec fixes it
// at seven days, matching the Build-log retention enforced by the Control Plane.
const LogRetention = 7 * 24 * time.Hour

// formatLogAge renders a duration in the hour unit `docker logs --since` accepts.
// Docker also takes a timestamp, but an age keeps the cut-off relative to "now"
// without the agent having to format one.
func formatLogAge(age time.Duration) string {
	hours := int(age.Hours())
	if hours < 1 {
		hours = 1
	}

	return strconv.Itoa(hours) + "h"
}

// splitTimestamp separates the RFC 3339 prefix `--timestamps` adds from the log
// line itself. A line that does not carry one is passed through with the current
// time, so nothing is ever dropped.
func splitTimestamp(line string) (time.Time, string) {
	prefix, message, found := strings.Cut(line, " ")
	if !found {
		return time.Now(), line
	}

	writtenAt, err := time.Parse(time.RFC3339Nano, prefix)
	if err != nil {
		return time.Now(), line
	}

	return writtenAt, message
}

// RemoveImage deletes a local image. Docker refuses while a container still
// references it, so the cleanup cannot delete the image a Service is running.
func (d *CLIDocker) RemoveImage(ctx context.Context, imageRef string) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"image", "rm", imageRef},
	})

	return err
}

// ListImages returns the tagged images whose reference starts with the given
// repository, oldest first. `docker image ls` sorts by creation time descending,
// so the result is reversed to make "keep the newest N" the obvious operation.
func (d *CLIDocker) ListImages(ctx context.Context, repositoryPrefix string) ([]ImageInfo, error) {
	output, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"image", "ls",
			"--filter", "reference=" + repositoryPrefix + "*",
			"--format", "{{.Repository}}:{{.Tag}}\t{{.CreatedAt}}",
		},
	})
	if err != nil {
		return nil, err
	}

	var images []ImageInfo
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		ref, createdAt, found := strings.Cut(line, "\t")
		if !found || strings.Contains(ref, "<none>") {
			continue
		}

		images = append(images, ImageInfo{Ref: ref, CreatedAt: parseDockerCreatedAt(createdAt)})
	}

	// Oldest first, so pruning is "drop everything before the last N".
	sort.Slice(images, func(i, j int) bool {
		return images[i].CreatedAt.Before(images[j].CreatedAt)
	})

	return images, nil
}

// dockerCreatedAtLayout is the format `docker image ls --format {{.CreatedAt}}`
// prints, e.g. "2026-11-08 02:43:11 +0000 UTC".
const dockerCreatedAtLayout = "2006-01-02 15:04:05 -0700 MST"

// parseDockerCreatedAt tolerates an unexpected format by treating the image as
// old, so a parsing change can never keep an image forever.
func parseDockerCreatedAt(value string) time.Time {
	createdAt, err := time.Parse(dockerCreatedAtLayout, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}

	return createdAt
}

// PruneBuildCache drops BuildKit cache entries older than olderThan. The Build
// cache is what makes repeat Builds fast, so it is only trimmed, never wiped.
func (d *CLIDocker) PruneBuildCache(ctx context.Context, olderThan time.Duration) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Env:  []string{"DOCKER_BUILDKIT=1"},
		Name: "docker",
		Args: []string{
			"buildx", "prune", "--force",
			"--filter", "until=" + formatPruneAge(olderThan),
		},
	})

	return err
}

// formatPruneAge renders a duration in the hour unit `docker buildx prune`
// accepts, rounding up so a short duration never becomes "until=0h".
func formatPruneAge(olderThan time.Duration) string {
	hours := int(olderThan.Hours())
	if hours < 1 {
		hours = 1
	}

	return strconv.Itoa(hours) + "h"
}

// EnsureVolume creates the Volume if it is missing and labels it. `docker volume
// create` is idempotent: for an existing Volume it returns the name and keeps
// the data, which is what makes a redeploy safe.
func (d *CLIDocker) EnsureVolume(ctx context.Context, spec VolumeSpec) error {
	if _, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"volume", "inspect", spec.Name, "--format", "{{.Name}}"},
	}); err == nil {
		// An existing Volume keeps its data, labels, and permissions. Recreating
		// or re-chmodding it on every Deploy would fight the application.
		return nil
	}

	args := []string{"volume", "create"}
	for _, pair := range sortedPairs(spec.Labels) {
		args = append(args, "--label", pair[0]+"="+pair[1])
	}
	args = append(args, spec.Name)

	if _, err := d.runner.Output(ctx, exec.Options{Name: "docker", Args: args}); err != nil {
		return err
	}

	// Docker creates a named Volume owned by root, but a Service image usually
	// runs as a non-root user. Opening the Volume to writes is what makes the
	// mount usable; the Volume is only ever attached to that Service's containers.
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none",
			"--mount", "type=volume,source=" + spec.Name + ",target=/volume",
			"--entrypoint", "/bin/sh",
			d.probeImage,
			"-c", "chmod 0777 /volume",
		},
	})

	return err
}

// VolumeUsage measures the Volume with a throwaway container. Docker has no
// portable per-Volume quota on the local driver, so the agent enforces the limit
// by measuring and reacting rather than by asking Docker to refuse writes.
func (d *CLIDocker) VolumeUsage(ctx context.Context, name string) (int64, bool, error) {
	if _, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"volume", "inspect", name, "--format", "{{.Name}}"},
	}); err != nil {
		return 0, false, nil
	}

	output, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none",
			"--mount", "type=volume,source=" + name + ",target=/volume,readonly",
			"--entrypoint", "/bin/sh",
			d.probeImage,
			"-c", "du -sk /volume | cut -f1",
		},
	})
	if err != nil {
		return 0, true, err
	}

	kilobytes, err := strconv.ParseInt(strings.TrimSpace(output), 10, 64)
	if err != nil {
		return 0, true, fmt.Errorf("read the Volume usage of %s: %w", name, err)
	}

	// Round up so a Volume that is a single byte over a megabyte is reported as
	// over the limit rather than truncated back under it.
	return (kilobytes + 1023) / 1024, true, nil
}

// ContainerStats samples one container with `docker stats`. Docker reports CPU
// as a percentage of one core, so it can exceed 100% on a multi-core host, and
// memory as a human-readable pair such as `12.5MiB / 512MiB`.
func (d *CLIDocker) ContainerStats(ctx context.Context, containerID string) (ContainerStats, error) {
	output, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"stats", "--no-stream", "--format", "{{json .}}", containerID},
	})
	if err != nil {
		return ContainerStats{}, err
	}

	var raw struct {
		CPUPerc  string `json:"CPUPerc"`
		MemUsage string `json:"MemUsage"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &raw); err != nil {
		return ContainerStats{}, fmt.Errorf("read the stats of container %s: %w", containerID, err)
	}

	return ContainerStats{
		CPUUsage:      parseCPUPercent(raw.CPUPerc),
		MemoryUsageMB: parseMemoryMB(raw.MemUsage),
	}, nil
}

// DumpDatabase runs pg_dump inside the Database container. The container's
// local socket trusts its own OS user, so no password crosses the command line
// or the agent process.
func (d *CLIDocker) DumpDatabase(
	ctx context.Context,
	containerName, databaseName, username, destPath string,
) error {
	return d.runner.OutputToFile(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"exec", containerName,
			"pg_dump", "--format=custom", "--no-password",
			"--username", username, "--dbname", databaseName,
		},
	}, destPath)
}

// ArchiveVolume streams a gzip compressed tar of the Volume to destPath through
// a throwaway container. Streaming avoids mounting the agent work directory into
// the helper, which would only work when the agent runs on the host.
func (d *CLIDocker) ArchiveVolume(ctx context.Context, volumeName, destPath string) error {
	return d.runner.OutputToFile(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none",
			"--mount", "type=volume,source=" + volumeName + ",target=/volume,readonly",
			"--entrypoint", "tar",
			d.probeImage,
			"-czf", "-", "-C", "/volume", ".",
		},
	}, destPath)
}

// RestoreDatabase loads a custom-format dump into a temporary Database and swaps
// it into place only after the load succeeds. A corrupt or partial dump
// therefore leaves the original Database exactly as it was.
func (d *CLIDocker) RestoreDatabase(
	ctx context.Context,
	containerName, databaseName, username, srcPath string,
) error {
	tempDatabase := restoreTempDatabaseName(srcPath)

	create := fmt.Sprintf("CREATE DATABASE %s", quoteSQLIdentifier(tempDatabase))
	if err := d.execSQL(ctx, containerName, username, "postgres", create); err != nil {
		return fmt.Errorf("create the temporary Database: %w", err)
	}

	loadErr := d.runner.RunFile(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"exec", "-i", containerName,
			"pg_restore", "--no-password",
			"--username", username, "--dbname", tempDatabase,
		},
	}, srcPath)
	if loadErr != nil {
		_ = d.execSQL(
			ctx,
			containerName,
			username,
			"postgres",
			fmt.Sprintf("DROP DATABASE IF EXISTS %s", quoteSQLIdentifier(tempDatabase)),
		)
		return fmt.Errorf("load the Backup into the temporary Database: %w", loadErr)
	}

	// The Services are stopped before a Restore starts, but a leftover client can
	// still hold a connection. Ending it is best effort: DROP DATABASE reports a
	// clear error if one survives.
	terminate := fmt.Sprintf(
		"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
		quoteSQLString(databaseName),
	)
	_ = d.execSQL(ctx, containerName, username, "postgres", terminate)

	drop := fmt.Sprintf("DROP DATABASE IF EXISTS %s", quoteSQLIdentifier(databaseName))
	if err := d.execSQL(ctx, containerName, username, "postgres", drop); err != nil {
		_ = d.execSQL(
			ctx,
			containerName,
			username,
			"postgres",
			fmt.Sprintf("DROP DATABASE IF EXISTS %s", quoteSQLIdentifier(tempDatabase)),
		)
		return fmt.Errorf("replace the Database: %w", err)
	}

	rename := fmt.Sprintf(
		"ALTER DATABASE %s RENAME TO %s",
		quoteSQLIdentifier(tempDatabase),
		quoteSQLIdentifier(databaseName),
	)
	if err := d.execSQL(ctx, containerName, username, "postgres", rename); err != nil {
		return fmt.Errorf("rename the restored Database: %w", err)
	}

	return nil
}

// RestoreVolume extracts the archive into a staging directory on the Volume and
// only replaces the existing contents after extraction succeeds. A corrupt
// archive therefore never removes the data that was already there.
func (d *CLIDocker) RestoreVolume(ctx context.Context, volumeName, srcPath string) error {
	staging := restoreStagingName(srcPath)
	mount := "type=volume,source=" + volumeName + ",target=/volume"

	if _, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none",
			"--mount", mount,
			"--entrypoint", "mkdir",
			d.probeImage,
			"-p", "/volume/" + staging,
		},
	}); err != nil {
		return fmt.Errorf("prepare the staging directory: %w", err)
	}

	extractErr := d.runner.RunFile(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "-i", "--network", "none",
			"--mount", mount,
			"--entrypoint", "tar",
			d.probeImage,
			"-xzf", "-", "-C", "/volume/" + staging,
		},
	}, srcPath)
	if extractErr != nil {
		d.removeVolumePath(ctx, mount, staging)
		return fmt.Errorf("extract the Backup into the staging directory: %w", extractErr)
	}

	script := restoreSwapScript(staging)
	if _, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none",
			"--mount", mount,
			"--entrypoint", "sh",
			d.probeImage,
			"-c", script,
		},
	}); err != nil {
		d.removeVolumePath(ctx, mount, staging)
		return fmt.Errorf("replace the Volume contents: %w", err)
	}

	return nil
}

// execSQL runs one psql statement inside a PostgreSQL container. The statement is
// passed as an argument, so it never goes through a shell.
func (d *CLIDocker) execSQL(
	ctx context.Context,
	containerName, username, database, statement string,
) error {
	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"exec", containerName,
			"psql", "--no-password", "--username", username,
			"--dbname", database, "--command", statement,
		},
	})

	return err
}

func (d *CLIDocker) removeVolumePath(ctx context.Context, mount, name string) {
	_, _ = d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none",
			"--mount", mount,
			"--entrypoint", "rm",
			d.probeImage,
			"-rf", "/volume/" + name,
		},
	})
}

// restoreTempDatabaseName derives a stable temporary Database name from the
// artifact file name, which the Control Plane sets to the Restore id.
func restoreTempDatabaseName(srcPath string) string {
	base := strings.TrimSuffix(filepath.Base(srcPath), filepath.Ext(srcPath))
	name := "stealth_restore_" + strings.ReplaceAll(sanitizeID(base), "-", "_")
	if len(name) > 63 {
		name = name[:63]
	}

	return name
}

func restoreStagingName(srcPath string) string {
	base := strings.TrimSuffix(filepath.Base(srcPath), filepath.Ext(srcPath))

	return ".stealth-restore-" + sanitizeID(base)
}

// restoreSwapScript replaces the Volume contents with the staged restore. The
// existing entries move aside first; if copying the staged tree fails, they are
// moved back before the script exits non-zero.
func restoreSwapScript(staging string) string {
	return `set -e
cd /volume
mkdir -p .stealth-restore-old
for entry in * .[!.]*; do
  [ -e "$entry" ] || continue
  case "$entry" in
    .stealth-restore-*) continue ;;
  esac
  mv "$entry" .stealth-restore-old/
done
if ! (cd "` + staging + `" && tar -cf - .) | tar -xf - -C .; then
  for entry in * .[!.]*; do
    [ -e "$entry" ] || continue
    case "$entry" in
      .stealth-restore-*) continue ;;
    esac
    rm -rf "$entry"
  done
  for entry in .stealth-restore-old/* .stealth-restore-old/.[!.]*; do
    [ -e "$entry" ] || continue
    mv "$entry" .
  done
  rm -rf .stealth-restore-old "` + staging + `"
  exit 1
fi
rm -rf .stealth-restore-old "` + staging + `"
`
}

// quoteSQLIdentifier quotes a PostgreSQL identifier. Values come from container
// labels the platform wrote, but quoting keeps a rename from changing meaning.
func quoteSQLIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

// quoteSQLString quotes a PostgreSQL string literal.
func quoteSQLString(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

// parseCPUPercent turns Docker's `12.50%` into vCPU.
func parseCPUPercent(value string) float64 {
	percent, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(value), "%"), 64)
	if err != nil || percent < 0 {
		return 0
	}

	return percent / 100
}

// parseMemoryMB turns Docker's `12.5MiB / 512MiB` into whole MiB.
func parseMemoryMB(value string) int64 {
	current := strings.TrimSpace(strings.Split(value, "/")[0])
	if current == "" {
		return 0
	}

	number := current
	unit := ""
	for _, candidate := range []string{"TiB", "GiB", "MiB", "KiB", "B"} {
		if strings.HasSuffix(current, candidate) {
			unit = candidate
			number = strings.TrimSpace(strings.TrimSuffix(current, candidate))
			break
		}
	}

	amount, err := strconv.ParseFloat(number, 64)
	if err != nil || amount < 0 {
		return 0
	}

	switch unit {
	case "TiB":
		amount *= 1024 * 1024
	case "GiB":
		amount *= 1024
	case "KiB":
		amount /= 1024
	case "B":
		amount /= 1024 * 1024
	}

	return int64(math.Round(amount))
}

// RemoveVolume deletes a Volume, reporting whether it existed. A Volume that is
// already gone counts as removed, so a retried cleanup never fails on a missing
// Volume.
func (d *CLIDocker) RemoveVolume(ctx context.Context, name string) (bool, error) {
	if _, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"volume", "inspect", name, "--format", "{{.Name}}"},
	}); err != nil {
		return false, nil
	}

	if _, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"volume", "rm", "--force", name},
	}); err != nil {
		return false, err
	}

	return true, nil
}

// ListVolumes returns the Volumes that carry every requested label. The labels
// are read back so the cleanup can attribute a Volume to its Service.
func (d *CLIDocker) ListVolumes(ctx context.Context, labels map[string]string) ([]VolumeInfo, error) {
	args := []string{"volume", "ls", "--format", "{{.Name}}"}
	for _, pair := range sortedPairs(labels) {
		args = append(args, "--filter", "label="+pair[0]+"="+pair[1])
	}

	output, err := d.runner.Output(ctx, exec.Options{Name: "docker", Args: args})
	if err != nil {
		return nil, err
	}

	var volumes []VolumeInfo
	for _, name := range strings.Fields(output) {
		raw, err := d.runner.Output(ctx, exec.Options{
			Name: "docker",
			Args: []string{"volume", "inspect", name, "--format", "{{json .}}"},
		})
		if err != nil {
			// A Volume can disappear between `ls` and `inspect`; skip it rather
			// than failing the whole listing.
			continue
		}

		var inspected struct {
			Name   string            `json:"Name"`
			Labels map[string]string `json:"Labels"`
		}
		if err := json.Unmarshal([]byte(raw), &inspected); err != nil {
			continue
		}
		volumes = append(volumes, VolumeInfo{Name: inspected.Name, Labels: inspected.Labels})
	}

	return volumes, nil
}

// Exec runs a command inside a running container. Standard input is used for
// secrets, so a password never appears in the Docker command line or in the
// error the agent might return.
func (d *CLIDocker) Exec(
	ctx context.Context,
	containerID string,
	command []string,
	stdin string,
) (string, error) {
	args := append([]string{"exec", "--interactive", containerID}, command...)

	return d.runner.Output(ctx, exec.Options{Name: "docker", Args: args, Stdin: stdin})
}

// WriteVolumeFiles writes files into a named Volume through a throwaway
// container. The content is base64-encoded into the script so a newline or a
// quote in a configuration file cannot break the command, and the helper runs as
// root only long enough to set ownership for the unprivileged container user.
func (d *CLIDocker) WriteVolumeFiles(
	ctx context.Context,
	volumeName string,
	files []VolumeFile,
) error {
	owner := defaultVolumeFileOwner
	if len(files) > 0 && files[0].Owner != "" {
		owner = files[0].Owner
	}
	if !safeVolumeFileOwner(owner) {
		return fmt.Errorf("invalid Volume file owner %q", owner)
	}

	script := "set -e; mkdir -p /target; chown " + owner + " /target;"
	for _, file := range files {
		if !safeVolumeFileName(file.Name) {
			return fmt.Errorf("invalid Volume file name %q", file.Name)
		}
		encoded := base64.StdEncoding.EncodeToString([]byte(file.Content))
		script += fmt.Sprintf(
			" printf '%%s' '%s' | base64 -d > /target/%s; chmod %04o /target/%s; chown %s /target/%s;",
			encoded,
			file.Name,
			file.Mode,
			file.Name,
			owner,
			file.Name,
		)
	}

	_, err := d.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{
			"run", "--rm", "--network", "none", "--user", "0:0",
			"--mount", "type=volume,source=" + volumeName + ",target=/target",
			"--entrypoint", "/bin/sh",
			d.probeImage,
			"-c", script,
		},
	})

	return err
}

// defaultVolumeFileOwner is the nginx user, which is the common case for a
// generated configuration. A Database passes the postgres user explicitly.
const defaultVolumeFileOwner = "101:101"

// safeVolumeFileOwner keeps the generated shell script from accepting anything
// but a numeric uid:gid pair.
func safeVolumeFileOwner(owner string) bool {
	parts := strings.Split(owner, ":")
	if len(parts) != 2 {
		return false
	}
	for _, part := range parts {
		if part == "" {
			return false
		}
		for _, char := range part {
			if char < '0' || char > '9' {
				return false
			}
		}
	}

	return true
}

// safeVolumeFileName keeps a file name from escaping the Volume's root.
func safeVolumeFileName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	for _, char := range name {
		switch {
		case char >= 'a' && char <= 'z':
		case char >= 'A' && char <= 'Z':
		case char >= '0' && char <= '9':
		case char == '.' || char == '_' || char == '-':
		default:
			return false
		}
	}

	return true
}

// sortedPairs keeps argument order stable, which makes the recorded commands in
// tests deterministic and a container's environment easy to read in `inspect`.
func sortedPairs(values map[string]string) [][2]string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	pairs := make([][2]string, 0, len(keys))
	for _, key := range keys {
		pairs = append(pairs, [2]string{key, values[key]})
	}

	return pairs
}
