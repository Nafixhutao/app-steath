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
	"stealth/agent/internal/build"
)

// Info reports Docker and BuildKit availability plus basic capacity.
type Info struct {
	Name    string
	exec    build.Executor
	timeout time.Duration
}

// New returns an Info that probes Docker through the given Executor.
func New(name string, exec build.Executor) *Info {
	return &Info{Name: name, exec: exec, timeout: 5 * time.Second}
}

// NodeInfo probes Docker and BuildKit. A failed probe reports the node as
// unhealthy instead of hiding the failure, so the Control Plane can block
// Deployments before a Build is attempted.
func (i *Info) NodeInfo() api.NodeInfo {
	ctx, cancel := context.WithTimeout(context.Background(), i.timeout)
	defer cancel()

	dockerVersion, err := i.exec.Output(ctx, build.ExecOptions{
		Name: "docker",
		Args: []string{"version", "--format", "{{.Server.Version}}"},
	})
	if err != nil {
		return api.NodeInfo{
			Name:              &i.Name,
			Status:            api.NodeInfoStatusOk,
			DockerVersion:     "unavailable",
			BuildkitAvailable: false,
			CpuCount:          pointer(runtime.NumCPU()),
			MemoryMb:          pointer(0),
		}
	}

	buildkitAvailable := i.buildkitAvailable(ctx)
	memoryMb := i.memoryMb()

	return api.NodeInfo{
		Name:              &i.Name,
		Status:            api.NodeInfoStatusOk,
		DockerVersion:     strings.TrimSpace(dockerVersion),
		BuildkitAvailable: buildkitAvailable,
		CpuCount:          pointer(runtime.NumCPU()),
		MemoryMb:          pointer(memoryMb),
	}
}

func (i *Info) buildkitAvailable(ctx context.Context) bool {
	output, err := i.exec.Output(ctx, build.ExecOptions{
		Name: "docker",
		Args: []string{"buildx", "version"},
	})
	if err != nil {
		return false
	}

	return strings.Contains(output, "buildx")
}

// memoryMb reads the total memory of the host from /proc when available and
// reports zero when the platform does not expose it.
func (i *Info) memoryMb() int {
	raw, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}

	for _, line := range strings.Split(string(raw), "\n") {
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

func pointer(value int) *int {
	return &value
}
