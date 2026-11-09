// Package runtime runs a built image as a Service container and manages the
// Caddy route in front of it. Everything here talks to Docker and Caddy through
// the exec.Executor seam, so the real Docker and Caddy are exercised by the
// tests instead of a mock of the platform's own logic.
package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	ResourceTypeService = "service"
	ResourceTypeVolume  = "volume"
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
	Environment  map[string]string
	// Volume is the Service's persistent Volume, mounted at MountPath. Nil
	// means the Service has no Volume.
	Volume *VolumeMount
	Labels map[string]string
	// ReadOnlyRoot keeps the container filesystem immutable; /tmp is a tmpfs.
	ReadOnlyRoot bool
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
	// RemoveVolume deletes a Volume and its data, reporting whether it existed.
	// A missing Volume is not an error, because removal must be safe to retry.
	RemoveVolume(ctx context.Context, name string) (bool, error)
	// ListVolumes returns the Volumes that match every label, with the labels the
	// cleanup needs to decide whether their Service still exists.
	ListVolumes(ctx context.Context, labels map[string]string) ([]VolumeInfo, error)
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
