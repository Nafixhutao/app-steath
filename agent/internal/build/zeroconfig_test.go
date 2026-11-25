package build

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeProjectFile(t *testing.T, root string, relative string, contents string) {
	t.Helper()

	path := filepath.Join(root, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("create %s: %v", relative, err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write %s: %v", relative, err)
	}
}

func TestDetectZeroConfigServesStaticSites(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeProjectFile(t, root, "index.html", "<h1>hi</h1>")

	generated, ok, err := detectZeroConfig(root, 3000)
	if err != nil || !ok {
		t.Fatalf("detect: ok=%v err=%v", ok, err)
	}
	if generated.Framework != "static site" {
		t.Fatalf("expected a static site, got %q", generated.Framework)
	}
	if generated.ContextDir != root {
		t.Fatalf("expected the repository root as context, got %q", generated.ContextDir)
	}
	if !strings.Contains(generated.Contents, "EXPOSE 3000") ||
		!strings.Contains(generated.Contents, `"-p", "3000"`) {
		t.Fatalf("expected the container port in the generated Dockerfile, got:\n%s", generated.Contents)
	}
	if !strings.Contains(generated.Contents, "rm -rf /src/.git") {
		t.Fatalf("expected .git to be stripped from the image, got:\n%s", generated.Contents)
	}
}

func TestDetectZeroConfigPicksTheSubfolderHoldingTheProject(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeProjectFile(t, root, "README.md", "gallery")
	writeProjectFile(t, root, "One Page Template/index.html", "<h1>hi</h1>")

	generated, ok, err := detectZeroConfig(root, 8080)
	if err != nil || !ok {
		t.Fatalf("detect: ok=%v err=%v", ok, err)
	}
	if generated.ContextDir != filepath.Join(root, "One Page Template") {
		t.Fatalf("expected the subfolder as context, got %q", generated.ContextDir)
	}
	if !strings.Contains(generated.Contents, "EXPOSE 8080") {
		t.Fatalf("expected the container port in the generated Dockerfile, got:\n%s", generated.Contents)
	}
}

func TestDetectZeroConfigRefusesToGuessBetweenProjects(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeProjectFile(t, root, "first/index.html", "one")
	writeProjectFile(t, root, "second/index.html", "two")

	_, ok, err := detectZeroConfig(root, 3000)
	if ok || err == nil {
		t.Fatalf("expected an error, got ok=%v err=%v", ok, err)
	}
	if !strings.Contains(err.Error(), "first, second") {
		t.Fatalf("expected the candidate projects in the error, got %q", err)
	}
}

func TestDetectZeroConfigBuildsNextJS(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeProjectFile(t, root, "package.json", `{"dependencies":{"next":"15.0.0"},"scripts":{"build":"next build","start":"next start"}}`)

	generated, ok, err := detectZeroConfig(root, 3000)
	if err != nil || !ok {
		t.Fatalf("detect: ok=%v err=%v", ok, err)
	}
	if generated.Framework != "Next.js" {
		t.Fatalf("expected a Next.js project, got %q", generated.Framework)
	}
	if !strings.Contains(generated.Contents, `CMD ["npx", "next", "start", "-p", "3000"]`) {
		t.Fatalf("expected Next.js to start on the container port, got:\n%s", generated.Contents)
	}
}

func TestDetectZeroConfigBuildsNodeWithAStartScript(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeProjectFile(t, root, "package.json", `{"scripts":{"start":"node server.js"}}`)

	generated, ok, err := detectZeroConfig(root, 3000)
	if err != nil || !ok {
		t.Fatalf("detect: ok=%v err=%v", ok, err)
	}
	if generated.Framework != "Node.js" {
		t.Fatalf("expected a Node.js project, got %q", generated.Framework)
	}
	if !strings.Contains(generated.Contents, `CMD ["npm", "start"]`) {
		t.Fatalf("expected npm start, got:\n%s", generated.Contents)
	}
}

func TestDetectZeroConfigRejectsUnknownRepositories(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeProjectFile(t, root, "notes.txt", "nothing to build")

	if _, ok, err := detectZeroConfig(root, 3000); ok || err != nil {
		t.Fatalf("expected no detection, got ok=%v err=%v", ok, err)
	}
}

func TestBuildUsesAGeneratedDockerfileWhenTheRepositoryHasNone(t *testing.T) {
	t.Parallel()

	executor := &fakeExecutor{
		noDockerfile: true,
		files:        map[string]string{"index.html": "<h1>hi</h1>"},
	}
	manager := NewManager(t.TempDir(), executor)
	request := newRequest()
	request.ContainerPort = 8080

	if _, err := manager.Start(context.Background(), request); err != nil {
		t.Fatalf("start build: %v", err)
	}

	finished := waitForStatus(t, manager, request.BuildID, StatusSucceeded)
	if finished.ImageRef != request.ImageTag {
		t.Fatalf("expected the image tag as reference, got %q", finished.ImageRef)
	}

	build := executor.recorded()[2]
	if !strings.Contains(build, "docker build --progress=plain") {
		t.Fatalf("expected a BuildKit build, got %q", build)
	}
	if !strings.Contains(build, "Dockerfile.stealth") {
		t.Fatalf("expected the generated Dockerfile to be used, got %q", build)
	}

	events, _, err := manager.EventsSince(request.BuildID, 0)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	var logged bool
	for _, event := range events {
		if strings.Contains(event.Message, "detected a static site") {
			logged = true
		}
	}
	if !logged {
		t.Fatalf("expected the detection in the log, got %v", events)
	}
}

func TestBuildUsesTheSubfolderFromTheRepositoryURL(t *testing.T) {
	t.Parallel()

	executor := &fakeExecutor{
		noDockerfile: true,
		files: map[string]string{
			"Horizontal Scroll/index.html": "<h1>hi</h1>",
		},
	}
	manager := NewManager(t.TempDir(), executor)
	request := newRequest()
	request.RepoURL = "https://github.com/octocat/templates/tree/master/Horizontal%20Scroll"

	if _, err := manager.Start(context.Background(), request); err != nil {
		t.Fatalf("start build: %v", err)
	}

	waitForStatus(t, manager, request.BuildID, StatusSucceeded)

	dirs := executor.recordedDirs()
	if len(dirs) < 3 || !strings.HasSuffix(dirs[2], filepath.FromSlash("Horizontal Scroll")) {
		t.Fatalf("expected the subfolder as build context, got %v", dirs)
	}
}

func TestBuildReportsWhenNoDockerfileOrFrameworkIsFound(t *testing.T) {
	t.Parallel()

	executor := &fakeExecutor{noDockerfile: true, files: map[string]string{"notes.txt": "hi"}}
	manager := NewManager(t.TempDir(), executor)

	if _, err := manager.Start(context.Background(), newRequest()); err != nil {
		t.Fatalf("start build: %v", err)
	}

	finished := waitForStatus(t, manager, newRequest().BuildID, StatusFailed)
	if !strings.Contains(finished.Error, "could not detect a framework") {
		t.Fatalf("expected a detection failure, got %q", finished.Error)
	}
}
