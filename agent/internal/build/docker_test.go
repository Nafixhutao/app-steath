package build

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	stealthexec "stealth/agent/internal/exec"
)

// These tests run real `git` and `docker` against the fixture repository, which
// is the only way to prove the Build pipeline actually works. They skip when
// Docker is not reachable so the unit tests stay runnable on any machine.

const dockerBuildDeadline = 5 * time.Minute

func requireDocker(t *testing.T) {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping Docker test in short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := exec.CommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}").Run(); err != nil {
		t.Skipf("Docker is not available: %v", err)
	}
}

// createFixtureRepository copies test/fixtures/hello-docker into a throwaway
// Git repository so the Build clones a real repository URL, exactly like it does
// for a user's Service. An empty dockerfile keeps the fixture's own Dockerfile;
// any other value replaces it so a test can force a failure.
func createFixtureRepository(t *testing.T, dockerfile string) string {
	t.Helper()

	fixture := filepath.Join("..", "..", "..", "test", "fixtures", "hello-docker")
	repository := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(repository, 0o750); err != nil {
		t.Fatalf("create repository directory: %v", err)
	}

	entries, err := os.ReadDir(fixture)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == "Dockerfile" {
			continue
		}
		copyFile(t, filepath.Join(fixture, entry.Name()), filepath.Join(repository, entry.Name()))
	}
	if dockerfile == "" {
		copyFile(t, filepath.Join(fixture, "Dockerfile"), filepath.Join(repository, "Dockerfile"))
	} else if err := os.WriteFile(filepath.Join(repository, "Dockerfile"), []byte(dockerfile), 0o600); err != nil {
		t.Fatalf("write Dockerfile: %v", err)
	}

	runGit(t, repository, "init", "--initial-branch=main")
	runGit(t, repository, "add", ".")
	runGit(
		t,
		repository,
		"-c", "user.email=agent@example.test",
		"-c", "user.name=Node Agent",
		"commit", "-m", "fixture",
	)

	return repository
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, output)
	}
}

func copyFile(t *testing.T, source, destination string) {
	t.Helper()

	content, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("read %s: %v", source, err)
	}
	if err := os.WriteFile(destination, content, 0o600); err != nil {
		t.Fatalf("write %s: %v", destination, err)
	}
}

// startBuild launches a Build and waits for it to finish, returning the final
// snapshot. Docker Builds take far longer than the unit-test deadline, so this
// loop uses its own bound and never sleeps a fixed amount.
func startBuild(t *testing.T, request Request) (*Manager, Snapshot) {
	t.Helper()

	manager := NewManager(filepath.Join(t.TempDir(), "builds"), stealthexec.SystemExecutor{})
	if _, err := manager.Start(context.Background(), request); err != nil {
		t.Fatalf("start build: %v", err)
	}

	deadline := time.Now().Add(dockerBuildDeadline)
	for time.Now().Before(deadline) {
		snapshot, err := manager.Get(request.BuildID)
		if err != nil {
			t.Fatalf("get build: %v", err)
		}
		if snapshot.Status != StatusRunning {
			return manager, snapshot
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("build did not finish within %s", dockerBuildDeadline)
	return nil, Snapshot{}
}

func buildLog(t *testing.T, manager *Manager, buildID string) string {
	t.Helper()

	events, _, err := manager.EventsSince(buildID, 0)
	if err != nil {
		t.Fatalf("read build log: %v", err)
	}

	messages := make([]string, 0, len(events))
	for _, event := range events {
		messages = append(messages, event.Message)
	}

	return strings.Join(messages, "\n")
}

func TestDockerBuildSucceedsForTheFixtureRepository(t *testing.T) {
	requireDocker(t)

	imageTag := "stealth-fixture/hello:test"
	t.Cleanup(func() {
		_ = exec.Command("docker", "image", "rm", "--force", imageTag).Run()
	})

	repository := createFixtureRepository(t, "")
	manager, snapshot := startBuild(t, Request{
		BuildID:        "docker-success",
		RepoURL:        repository,
		Branch:         "main",
		DockerfilePath: "Dockerfile",
		ImageTag:       imageTag,
	})

	if snapshot.Status != StatusSucceeded {
		t.Fatalf("expected a successful build, got %q (%s)", snapshot.Status, snapshot.Error)
	}
	if snapshot.ImageRef != imageTag {
		t.Fatalf("expected image %q, got %q", imageTag, snapshot.ImageRef)
	}
	if len(snapshot.CommitSHA) != 40 {
		t.Fatalf("expected a full commit SHA, got %q", snapshot.CommitSHA)
	}

	output := buildLog(t, manager, snapshot.BuildID)
	for _, expected := range []string{"Cloning", "Checked out commit", "Building image", "Built image"} {
		if !strings.Contains(output, expected) {
			t.Fatalf("expected %q in the build log, got:\n%s", expected, output)
		}
	}

	// The image exists and carries the tag the Control Plane will deploy.
	if err := exec.Command("docker", "image", "inspect", imageTag).Run(); err != nil {
		t.Fatalf("expected image %q to exist: %v", imageTag, err)
	}
}

func TestDockerBuildFailsForABrokenDockerfile(t *testing.T) {
	requireDocker(t)

	imageTag := "stealth-fixture/broken:test"
	t.Cleanup(func() {
		_ = exec.Command("docker", "image", "rm", "--force", imageTag).Run()
	})

	repository := createFixtureRepository(t, "FROM busybox:1.36\nRUN exit 1\n")
	manager, snapshot := startBuild(t, Request{
		BuildID:        "docker-failure",
		RepoURL:        repository,
		Branch:         "main",
		DockerfilePath: "Dockerfile",
		ImageTag:       imageTag,
	})

	if snapshot.Status != StatusFailed {
		t.Fatalf("expected a failed build, got %q", snapshot.Status)
	}
	if snapshot.ImageRef != "" {
		t.Fatalf("a failed build must not report an image, got %q", snapshot.ImageRef)
	}
	if !strings.Contains(snapshot.Error, "Build failed") {
		t.Fatalf("expected a build failure message, got %q", snapshot.Error)
	}

	output := buildLog(t, manager, snapshot.BuildID)
	if !strings.Contains(output, "exit code: 1") {
		t.Fatalf("expected the builder failure in the log, got:\n%s", output)
	}

	// A failed Build must not leave an image behind for the runtime to deploy.
	if err := exec.Command("docker", "image", "inspect", imageTag).Run(); err == nil {
		t.Fatalf("expected no image %q after a failed build", imageTag)
	}
}

func TestDockerBuildFailsForAMissingDockerfile(t *testing.T) {
	requireDocker(t)

	repository := createFixtureRepository(t, "")
	manager, snapshot := startBuild(t, Request{
		BuildID:        "docker-missing-dockerfile",
		RepoURL:        repository,
		Branch:         "main",
		DockerfilePath: "deploy/Dockerfile",
		ImageTag:       "stealth-fixture/missing:test",
	})

	if snapshot.Status != StatusFailed {
		t.Fatalf("expected a failed build, got %q", snapshot.Status)
	}
	if !strings.Contains(snapshot.Error, "Dockerfile not found") {
		t.Fatalf("expected a missing Dockerfile message, got %q", snapshot.Error)
	}

	output := buildLog(t, manager, snapshot.BuildID)
	if !strings.Contains(output, "Dockerfile not found") {
		t.Fatalf("expected the failure in the log, got:\n%s", output)
	}
}

func TestDockerBuildFailsForAnUnknownBranch(t *testing.T) {
	requireDocker(t)

	repository := createFixtureRepository(t, "")
	manager, snapshot := startBuild(t, Request{
		BuildID:        "docker-unknown-branch",
		RepoURL:        repository,
		Branch:         "does-not-exist",
		DockerfilePath: "Dockerfile",
		ImageTag:       "stealth-fixture/branch:test",
	})

	if snapshot.Status != StatusFailed {
		t.Fatalf("expected a failed build, got %q", snapshot.Status)
	}
	if !strings.Contains(snapshot.Error, "Could not clone the repository") {
		t.Fatalf("expected a clone failure message, got %q", snapshot.Error)
	}

	output := buildLog(t, manager, snapshot.BuildID)
	if !strings.Contains(output, "does-not-exist") {
		t.Fatalf("expected the clone error in the log, got:\n%s", output)
	}
}
