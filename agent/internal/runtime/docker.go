// Package runtime runs a built image as a Service container and manages the
// Caddy route in front of it. Everything here talks to Docker and Caddy through
// the exec.Executor seam, so the real Docker and Caddy are exercised by the
// tests instead of a mock of the platform's own logic.
package runtime

import (
	"context"
	"encoding/json"
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

	ResourceTypeService = "service"
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
	Labels       map[string]string
	// ReadOnlyRoot keeps the container filesystem immutable; /tmp is a tmpfs.
	ReadOnlyRoot bool
}

// ContainerInfo is what the agent needs to know about a container.
type ContainerInfo struct {
	ID       string
	Name     string
	State    string
	Labels   map[string]string
	Networks []string
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
		"--expose", strconv.Itoa(spec.Port),
	}

	if spec.ReadOnlyRoot {
		// A read-only root filesystem still needs somewhere to write; /tmp is a
		// small tmpfs with noexec and nosuid.
		args = append(args, "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m")
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
		return "", err
	}

	return strings.TrimSpace(output), nil
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
	args := []string{"logs", "--timestamps", "--tail", strconv.Itoa(tail)}
	if follow {
		args = append(args, "--follow")
	}
	args = append(args, containerID)

	return d.runner.Stream(ctx, exec.Options{Name: "docker", Args: args}, func(line string) {
		writtenAt, message := splitTimestamp(line)
		onLine(writtenAt, message)
	})
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
