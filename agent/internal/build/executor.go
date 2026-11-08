package build

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"sync"
)

// ExecOptions describes one external command. Commands are always executed
// without a shell, so repository values can never inject extra commands.
type ExecOptions struct {
	Dir  string
	Env  []string
	Name string
	Args []string
}

// Executor runs the commands a Build needs. Tests substitute a fake, and the
// real implementation shells out to git and docker.
type Executor interface {
	// Stream runs the command and reports each output line as it arrives.
	Stream(ctx context.Context, options ExecOptions, onLine func(string)) error
	// Output runs the command and returns its standard output.
	Output(ctx context.Context, options ExecOptions) (string, error)
}

// SystemExecutor runs commands on the host.
type SystemExecutor struct{}

// Stream runs the command and forwards stdout and stderr line by line.
func (SystemExecutor) Stream(
	ctx context.Context,
	options ExecOptions,
	onLine func(string),
) error {
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

// Output runs the command and returns the trimmed standard output.
func (SystemExecutor) Output(ctx context.Context, options ExecOptions) (string, error) {
	cmd := exec.CommandContext(ctx, options.Name, options.Args...)
	cmd.Dir = options.Dir
	if len(options.Env) > 0 {
		cmd.Env = append(cmd.Environ(), options.Env...)
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("%s: %w: %s", options.Name, err, stderr.String())
	}

	return string(output), nil
}

func forwardLines(stream io.Reader, onLine func(string)) {
	scanner := bufio.NewScanner(stream)
	// Build output can contain long lines from progress rendering.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		onLine(scanner.Text())
	}
}
