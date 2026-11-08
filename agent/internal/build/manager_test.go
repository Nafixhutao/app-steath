package build

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"stealth/agent/internal/exec"
)

// fakeExecutor stands in for git and docker so the Manager can be tested
// without touching the host.
type fakeExecutor struct {
	mu       sync.Mutex
	commands []string
	stream   func(ctx context.Context, options exec.Options, onLine func(string)) error
	output   func(ctx context.Context, options exec.Options) (string, error)
}

func (f *fakeExecutor) Stream(
	ctx context.Context,
	options exec.Options,
	onLine func(string),
) error {
	f.record(options)
	prepareCheckout(options)

	if f.stream != nil {
		return f.stream(ctx, options, onLine)
	}

	onLine(options.Name + " ran")
	return nil
}

// prepareCheckout stands in for the clone by creating the checked out tree the
// Manager later inspects for the Dockerfile.
func prepareCheckout(options exec.Options) {
	if options.Name != "git" || len(options.Args) < 2 || options.Args[0] != "clone" {
		return
	}

	checkout := options.Args[len(options.Args)-1]
	_ = os.MkdirAll(checkout, 0o750)
	_ = os.WriteFile(filepath.Join(checkout, "Dockerfile"), []byte("FROM busybox\n"), 0o600)
}

func (f *fakeExecutor) Output(ctx context.Context, options exec.Options) (string, error) {
	f.record(options)

	if f.output != nil {
		return f.output(ctx, options)
	}

	return "deadbeef\n", nil
}

func (f *fakeExecutor) record(options exec.Options) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, options.Name+" "+strings.Join(options.Args, " "))
}

func (f *fakeExecutor) recorded() []string {
	f.mu.Lock()
	defer f.mu.Unlock()

	return append([]string(nil), f.commands...)
}

func newRequest() Request {
	return Request{
		BuildID:        "deployment-1",
		RepoURL:        "https://example.test/repo.git",
		Branch:         "main",
		DockerfilePath: "Dockerfile",
		ImageTag:       "stealth/service:deployment-1",
	}
}

// waitForStatus polls until the Build reaches the wanted status or the deadline
// passes, so the test never depends on a fixed sleep.
func waitForStatus(t *testing.T, manager *Manager, buildID string, want Status) Snapshot {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		snapshot, err := manager.Get(buildID)
		if err != nil {
			t.Fatalf("get build: %v", err)
		}
		if snapshot.Status == want {
			return snapshot
		}
		time.Sleep(5 * time.Millisecond)
	}

	snapshot, _ := manager.Get(buildID)
	t.Fatalf("build did not reach %q, last status %q", want, snapshot.Status)
	return Snapshot{}
}

func TestStartBuildClonesAndBuildsWithBuildKit(t *testing.T) {
	manager := NewManager(t.TempDir(), &fakeExecutor{})

	snapshot, err := manager.Start(context.Background(), newRequest())
	if err != nil {
		t.Fatalf("start build: %v", err)
	}
	if snapshot.Status != StatusRunning {
		t.Fatalf("expected a running build, got %q", snapshot.Status)
	}

	finished := waitForStatus(t, manager, "deployment-1", StatusSucceeded)
	if finished.ImageRef != "stealth/service:deployment-1" {
		t.Fatalf("expected the image tag as reference, got %q", finished.ImageRef)
	}
	if finished.CommitSHA != "deadbeef" {
		t.Fatalf("expected the checked out commit, got %q", finished.CommitSHA)
	}
	if finished.FinishedAt == nil {
		t.Fatal("expected a finish time")
	}

	executor := manager.executor.(*fakeExecutor)
	commands := executor.recorded()
	if len(commands) != 3 {
		t.Fatalf("expected clone, rev-parse, and build, got %v", commands)
	}
	if !strings.HasPrefix(commands[0], "git clone --depth 1 --single-branch --branch main") {
		t.Fatalf("expected a shallow single-branch clone, got %q", commands[0])
	}
	if !strings.HasPrefix(commands[1], "git rev-parse HEAD") {
		t.Fatalf("expected the commit to be read, got %q", commands[1])
	}
	if !strings.HasPrefix(commands[2], "docker build --progress=plain") {
		t.Fatalf("expected a BuildKit build, got %q", commands[2])
	}

	events, done, err := manager.EventsSince("deployment-1", 0)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	if !done {
		t.Fatal("expected a finished build to report done")
	}
	if len(events) == 0 {
		t.Fatal("expected build log events")
	}
	for index, event := range events {
		if event.Sequence != index+1 {
			t.Fatalf("expected sequential numbering, got %d at position %d", event.Sequence, index)
		}
	}

	// A cursor replays only what the caller has not seen.
	replayed, _, err := manager.EventsSince("deployment-1", len(events)-1)
	if err != nil {
		t.Fatalf("read events after cursor: %v", err)
	}
	if len(replayed) != 1 || replayed[0].Sequence != len(events) {
		t.Fatalf("expected only the last event, got %v", replayed)
	}
}

func TestStartBuildIsIdempotentForTheSameDeployment(t *testing.T) {
	executor := &fakeExecutor{}
	manager := NewManager(t.TempDir(), executor)

	if _, err := manager.Start(context.Background(), newRequest()); err != nil {
		t.Fatalf("start build: %v", err)
	}
	waitForStatus(t, manager, "deployment-1", StatusSucceeded)

	if _, err := manager.Start(context.Background(), newRequest()); err != nil {
		t.Fatalf("start build again: %v", err)
	}

	if commands := executor.recorded(); len(commands) != 3 {
		t.Fatalf("expected the second request to reuse the build, got %v", commands)
	}
}

func TestStartBuildRejectsIncompleteRequests(t *testing.T) {
	manager := NewManager(t.TempDir(), &fakeExecutor{})

	cases := map[string]func(*Request){
		"missing build id":   func(r *Request) { r.BuildID = "" },
		"missing repo url":   func(r *Request) { r.RepoURL = "" },
		"missing branch":     func(r *Request) { r.Branch = "" },
		"missing dockerfile": func(r *Request) { r.DockerfilePath = "" },
		"missing image tag":  func(r *Request) { r.ImageTag = "" },
	}

	for name, mutate := range cases {
		request := newRequest()
		mutate(&request)

		if _, err := manager.Start(context.Background(), request); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s: expected an invalid request error, got %v", name, err)
		}
	}
}

func TestBuildFailureKeepsTheErrorAndLog(t *testing.T) {
	executor := &fakeExecutor{
		stream: func(ctx context.Context, options exec.Options, onLine func(string)) error {
			if options.Name == "docker" {
				onLine("error: failed to solve: process did not complete successfully")
				return errors.New("exit status 1")
			}
			onLine("cloned")
			return nil
		},
	}
	manager := NewManager(t.TempDir(), executor)

	if _, err := manager.Start(context.Background(), newRequest()); err != nil {
		t.Fatalf("start build: %v", err)
	}

	failed := waitForStatus(t, manager, "deployment-1", StatusFailed)
	if !strings.Contains(failed.Error, "Build failed") {
		t.Fatalf("expected a build failure message, got %q", failed.Error)
	}
	if failed.ImageRef != "" {
		t.Fatalf("a failed build must not report an image, got %q", failed.ImageRef)
	}

	events, _, err := manager.EventsSince("deployment-1", 0)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	var messages []string
	for _, event := range events {
		messages = append(messages, event.Message)
	}
	joined := strings.Join(messages, "\n")
	if !strings.Contains(joined, "failed to solve") {
		t.Fatalf("expected the builder output in the log, got %q", joined)
	}
	if !strings.Contains(joined, "Build failed") {
		t.Fatalf("expected the failure reason in the log, got %q", joined)
	}
}

func TestCancelBuildStopsARunningBuild(t *testing.T) {
	started := make(chan struct{})
	executor := &fakeExecutor{
		stream: func(ctx context.Context, options exec.Options, onLine func(string)) error {
			if options.Name == "git" {
				onLine("cloned")
				return nil
			}
			close(started)
			<-ctx.Done()
			return ctx.Err()
		},
	}
	manager := NewManager(t.TempDir(), executor)

	if _, err := manager.Start(context.Background(), newRequest()); err != nil {
		t.Fatalf("start build: %v", err)
	}
	<-started

	if _, err := manager.Cancel("deployment-1"); err != nil {
		t.Fatalf("cancel build: %v", err)
	}

	cancelled := waitForStatus(t, manager, "deployment-1", StatusCancelled)
	if cancelled.Error != "" {
		t.Fatalf("a cancelled build must not carry an error, got %q", cancelled.Error)
	}
}

func TestCancelKeepsTheStatusOfAFinishedBuild(t *testing.T) {
	manager := NewManager(t.TempDir(), &fakeExecutor{})

	if _, err := manager.Start(context.Background(), newRequest()); err != nil {
		t.Fatalf("start build: %v", err)
	}
	waitForStatus(t, manager, "deployment-1", StatusSucceeded)

	snapshot, err := manager.Cancel("deployment-1")
	if err != nil {
		t.Fatalf("cancel build: %v", err)
	}
	if snapshot.Status != StatusSucceeded {
		t.Fatalf("expected the finished status to survive, got %q", snapshot.Status)
	}
}

func TestUnknownBuildIsReported(t *testing.T) {
	manager := NewManager(t.TempDir(), &fakeExecutor{})

	if _, err := manager.Get("nope"); !errors.Is(err, ErrUnknownBuild) {
		t.Fatalf("expected an unknown build error, got %v", err)
	}
	if _, err := manager.Cancel("nope"); !errors.Is(err, ErrUnknownBuild) {
		t.Fatalf("expected an unknown build error, got %v", err)
	}
	if _, _, err := manager.EventsSince("nope", 0); !errors.Is(err, ErrUnknownBuild) {
		t.Fatalf("expected an unknown build error, got %v", err)
	}
}
