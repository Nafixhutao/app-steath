// Package exec runs external commands for the Node Agent. Both the Build and the
// runtime need to shell out to git, docker, and Caddy, so the process handling
// lives here instead of in either caller.
package exec

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// Options describes one external command. Commands are always executed without
// a shell, so repository and user supplied values can never inject extra
// commands.
type Options struct {
	Dir  string
	Env  []string
	Name string
	Args []string
}

// Executor runs the commands the Node Agent needs. Tests substitute a fake, and
// the real implementation shells out to the host.
type Executor interface {
	// Stream runs the command and reports each output line as it arrives.
	Stream(ctx context.Context, options Options, onLine func(string)) error
	// Output runs the command and returns its standard output.
	Output(ctx context.Context, options Options) (string, error)
}

// SystemExecutor runs commands on the host.
type SystemExecutor struct{}

// Stream runs the command and forwards stdout and stderr line by line.
func (SystemExecutor) Stream(ctx context.Context, options Options, onLine func(string)) error {
	cmd := exec.CommandContext(ctx, options.Name, options.Args...)
	cmd.Dir = options.Dir
	if len(options.Env) > 0 {
		cmd.Env = append(cmd.Environ(), options.Env...)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("open stderr: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start %s: %w", options.Name, err)
	}

	var readers sync.WaitGroup
	readers.Add(2)
	for _, stream := range []io.Reader{stdout, stderr} {
		go func(stream io.Reader) {
			defer readers.Done()
			forwardLines(stream, onLine)
		}(stream)
	}
	readers.Wait()

	return cmd.Wait()
}

// Output runs the command and returns the trimmed standard output. On failure the
// error carries both streams, because a command like `docker run` reports the
// reason a probe failed on its standard output, not its standard error.
func (SystemExecutor) Output(ctx context.Context, options Options) (string, error) {
	cmd := exec.CommandContext(ctx, options.Name, options.Args...)
	cmd.Dir = options.Dir
	if len(options.Env) > 0 {
		cmd.Env = append(cmd.Environ(), options.Env...)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf(
			"%s: %w: %s",
			options.Name,
			err,
			strings.TrimSpace(stderr.String()+stdout.String()),
		)
	}

	return stdout.String(), nil
}

func forwardLines(stream io.Reader, onLine func(string)) {
	scanner := bufio.NewScanner(stream)
	// Build output can contain long lines from progress rendering.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		onLine(scanner.Text())
	}
}
