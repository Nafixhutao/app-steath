// Package node inspects the host so the Control Plane can show what the Node
// Agent is running on and whether BuildKit is usable.
package node

import (
	"context"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"stealth/agent/internal/api"
	"stealth/agent/internal/exec"
)

// Info reports Docker and BuildKit availability plus basic capacity.
type Info struct {
	Name    string
	runner  exec.Executor
	timeout time.Duration
}

// New returns an Info that probes Docker through the given Executor.
func New(name string, runner exec.Executor) *Info {
	return &Info{Name: name, runner: runner, timeout: 5 * time.Second}
}

// NodeInfo probes Docker and BuildKit. A failed probe reports the node as
// unhealthy instead of hiding the failure, so the Control Plane can block
// Deployments before a Build is attempted.
func (i *Info) NodeInfo() api.NodeInfo {
	ctx, cancel := context.WithTimeout(context.Background(), i.timeout)
	defer cancel()

	dockerVersion, err := i.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"version", "--format", "{{.Server.Version}}"},
	})
	if err != nil {
		status := api.NodeInfoStatus("error")
		return api.NodeInfo{
			Name:              &i.Name,
			Status:            status,
			DockerVersion:     "unavailable",
			BuildkitAvailable: false,
			CpuCount:          pointer(runtime.NumCPU()),
			MemoryMb:          pointer(memoryMB()),
		}
	}

	status := api.NodeInfoStatus("ok")
	buildkit := i.buildkitAvailable(ctx)

	return api.NodeInfo{
		Name:              &i.Name,
		Status:            status,
		DockerVersion:     strings.TrimSpace(dockerVersion),
		BuildkitAvailable: buildkit,
		CpuCount:          pointer(runtime.NumCPU()),
		MemoryMb:          pointer(memoryMB()),
	}
}

// buildkitAvailable asks the Docker daemon whether the BuildKit builder is
// usable, which is what a Build actually needs.
func (i *Info) buildkitAvailable(ctx context.Context) bool {
	_, err := i.runner.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"buildx", "version"},
	})

	return err == nil
}

func pointer[T any](value T) *T {
	return &value
}

// memoryMB reports total host memory in megabytes, or 0 when it cannot be read.
func memoryMB() int {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}

	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}

		kilobytes, err := strconv.Atoi(fields[1])
		if err != nil {
			return 0
		}

		return kilobytes / 1024
	}

	return 0
}
