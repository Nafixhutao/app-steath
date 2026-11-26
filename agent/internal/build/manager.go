// Package build runs the Build half of a Deployment on the node: it clones a
// public repository at a branch, builds the Dockerfile with BuildKit, and keeps
// the streamed log in memory so the Control Plane can read it while the Build
// runs and after it finishes.
package build

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"stealth/agent/internal/exec"
)

// Status is the state of a single Build.
type Status string

const (
	StatusRunning   Status = "running"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

// cancelWait bounds how long Cancel waits for a cancelled Build to unwind, so a
// stuck command cannot block the HTTP handler forever.
const cancelWait = 10 * time.Second

// defaultDockerfilePath is the path a Service uses unless the user names one.
// Only this path may fall back to zero-config: a custom path is an explicit
// instruction, and building something else would hide the mistake.
const defaultDockerfilePath = "Dockerfile"

// Request describes one Build. BuildID is the Deployment id, so starting the
// same Build twice returns the existing Build instead of a second one.
type Request struct {
	BuildID        string
	RepoURL        string
	Branch         string
	DockerfilePath string
	ImageTag       string
	// ContainerPort is where the Deployer expects the container to listen. It is
	// only used when the repository has no Dockerfile and the Agent generates one.
	ContainerPort int
	// CommitSHA pins the Build to an exact commit. A redeploy sets it so the new
	// Deployment rebuilds the same code as the one it replaces; an empty value
	// means the tip of the branch.
	CommitSHA string
}

// Snapshot is a copy of a Build's observable state.
type Snapshot struct {
	BuildID    string
	Status     Status
	ImageRef   string
	CommitSHA  string
	Error      string
	StartedAt  time.Time
	FinishedAt *time.Time
}

// LogEvent is one line of Build output with a monotonic sequence number.
type LogEvent struct {
	Sequence  int
	Message   string
	Timestamp time.Time
}

// ErrUnknownBuild is returned when a Build id was never started.
var ErrUnknownBuild = errors.New("unknown build")

// ErrInvalidRequest is returned for a Request that cannot be built.
var ErrInvalidRequest = errors.New("invalid build request")

type buildState struct {
	request   Request
	status    Status
	imageRef  string
	commitSHA string
	err       string
	startedAt time.Time
	finished  *time.Time
	logs      []LogEvent
	cancel    context.CancelFunc
	done      chan struct{}
}

// Manager owns every Build on this node. Builds run in the background so the
// HTTP handler can answer immediately and the Control Plane can stream logs.
type Manager struct {
	mu        sync.Mutex
	builds    map[string]*buildState
	workRoot  string
	executor  exec.Executor
	clock     func() time.Time
	maxBuilds int
}

// NewManager returns a Manager that keeps Build workspaces under workRoot.
func NewManager(workRoot string, executor exec.Executor) *Manager {
	return &Manager{
		builds:    make(map[string]*buildState),
		workRoot:  workRoot,
		executor:  executor,
		clock:     time.Now,
		maxBuilds: 50,
	}
}

// Start validates the Request, records the Build, and runs it in the background.
// Calling Start with a known BuildID returns the existing Build unchanged, which
// makes the operation idempotent across Control Plane retries.
func (m *Manager) Start(ctx context.Context, request Request) (Snapshot, error) {
	if err := request.validate(); err != nil {
		return Snapshot{}, err
	}

	m.mu.Lock()
	if existing, ok := m.builds[request.BuildID]; ok {
		snapshot := existing.snapshot()
		m.mu.Unlock()
		return snapshot, nil
	}
	m.pruneLocked()

	// The Build outlives the request that started it, so it must not inherit
	// the request's cancellation.
	buildContext, cancel := context.WithCancel(context.WithoutCancel(ctx))
	state := &buildState{
		request:   request,
		status:    StatusRunning,
		startedAt: m.clock(),
		cancel:    cancel,
		done:      make(chan struct{}),
	}
	m.builds[request.BuildID] = state
	m.appendLocked(state, fmt.Sprintf("Starting build for %s", request.RepoURL))
	snapshot := state.snapshot()
	m.mu.Unlock()

	go m.execute(buildContext, state)

	return snapshot, nil
}

// Get returns the current state of a Build.
func (m *Manager) Get(buildID string) (Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.builds[buildID]
	if !ok {
		return Snapshot{}, ErrUnknownBuild
	}

	return state.snapshot(), nil
}

// Cancel stops a running Build and waits for it to settle, so the caller sees
// the final status instead of racing the Build goroutine. A Build that already
// finished keeps its status, so cancelling twice is safe.
func (m *Manager) Cancel(buildID string) (Snapshot, error) {
	m.mu.Lock()
	state, ok := m.builds[buildID]
	if !ok {
		m.mu.Unlock()
		return Snapshot{}, ErrUnknownBuild
	}
	if state.status == StatusRunning {
		state.cancel()
	}
	done := state.done
	m.mu.Unlock()

	select {
	case <-done:
	case <-time.After(cancelWait):
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	return state.snapshot(), nil
}

// EventsSince returns the log events with a sequence greater than after and
// whether the Build has finished, so a streaming handler knows when to stop.
func (m *Manager) EventsSince(buildID string, after int) ([]LogEvent, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, ok := m.builds[buildID]
	if !ok {
		return nil, false, ErrUnknownBuild
	}

	events := make([]LogEvent, 0, len(state.logs))
	for _, event := range state.logs {
		if event.Sequence > after {
			events = append(events, event)
		}
	}

	return events, state.status != StatusRunning, nil
}

// execute runs one Build to completion and publishes a single terminal status.
// The workspace is removed before the status is published so a caller that sees
// a finished Build can rely on the disk being clean again.
func (m *Manager) execute(ctx context.Context, state *buildState) {
	workspace := filepath.Join(m.workRoot, state.request.BuildID)
	status, imageRef, errMessage := m.run(ctx, state, workspace)
	_ = os.RemoveAll(workspace)
	m.complete(state, status, imageRef, errMessage)
}

func (m *Manager) run(ctx context.Context, state *buildState, workspace string) (Status, string, string) {
	if err := os.MkdirAll(workspace, 0o750); err != nil {
		return StatusFailed, "", fmt.Sprintf("Could not prepare the Build workspace: %v", err)
	}

	// Clone into a directory that does not exist yet, so git owns it.
	checkout := filepath.Join(workspace, "src")
	// A user often pastes the browser URL of the repository page, including a
	// GitHub "tree" URL that points at a subfolder and names the branch in the
	// path. Git only understands the bare clone URL, so the request is
	// normalized before it reaches the clone command.
	repoURL, branch, subdirectory := normalizeRepoRequest(state.request.RepoURL, state.request.Branch)
	if repoURL != state.request.RepoURL || branch != state.request.Branch {
		m.append(state, fmt.Sprintf("Normalized repository URL to %s at branch %s", repoURL, branch))
	}
	if subdirectory != "" {
		m.append(state, fmt.Sprintf("Using repository subfolder %s as the project root", subdirectory))
	}
	m.append(state, fmt.Sprintf("Cloning %s at branch %s", repoURL, branch))
	cloneErr := m.executor.Stream(ctx, exec.Options{
		Dir:  workspace,
		Name: "git",
		Args: []string{
			"clone", "--depth", "1", "--single-branch",
			"--branch", branch,
			repoURL, checkout,
		},
	}, func(line string) { m.append(state, line) })
	if cloneErr != nil {
		if ctx.Err() != nil {
			return StatusCancelled, "", ""
		}
		return StatusFailed, "", fmt.Sprintf("Could not clone the repository: %v", cloneErr)
	}

	commitSHA, err := m.executor.Output(ctx, exec.Options{
		Dir:  checkout,
		Name: "git",
		Args: []string{"rev-parse", "HEAD"},
	})
	if err != nil {
		if ctx.Err() != nil {
			return StatusCancelled, "", ""
		}
		return StatusFailed, "", fmt.Sprintf("Could not read the checked out commit: %v", err)
	}
	commitSHA = strings.TrimSpace(commitSHA)

	// A redeploy pins the Build to the commit it is replacing, so the same code
	// is rebuilt even when the branch has moved on. The clone is shallow, so the
	// exact commit has to be fetched by id.
	if want := strings.TrimSpace(state.request.CommitSHA); want != "" && !strings.HasPrefix(commitSHA, want) {
		m.append(state, fmt.Sprintf("Fetching commit %s", want))
		fetchErr := m.executor.Stream(ctx, exec.Options{
			Dir:  checkout,
			Name: "git",
			Args: []string{"fetch", "--depth", "1", "origin", want},
		}, func(line string) { m.append(state, line) })
		if fetchErr != nil {
			if ctx.Err() != nil {
				return StatusCancelled, "", ""
			}
			// Some servers refuse a fetch by id, so the branch is fetched and the
			// commit is resolved from the objects it brought along.
			m.append(state, fmt.Sprintf("Could not fetch the commit by id, fetching %s instead", state.request.Branch))
			branchErr := m.executor.Stream(ctx, exec.Options{
				Dir:  checkout,
				Name: "git",
				Args: []string{"fetch", "--depth", "1", "origin", state.request.Branch},
			}, func(line string) { m.append(state, line) })
			if branchErr != nil {
				if ctx.Err() != nil {
					return StatusCancelled, "", ""
				}
				return StatusFailed, "", fmt.Sprintf("Could not fetch commit %s: %v", want, fetchErr)
			}
		}

		checkoutErr := m.executor.Stream(ctx, exec.Options{
			Dir:  checkout,
			Name: "git",
			Args: []string{"checkout", want},
		}, func(line string) { m.append(state, line) })
		if checkoutErr != nil {
			if ctx.Err() != nil {
				return StatusCancelled, "", ""
			}
			return StatusFailed, "", fmt.Sprintf("Could not check out commit %s: %v", want, checkoutErr)
		}

		resolved, resolveErr := m.executor.Output(ctx, exec.Options{
			Dir:  checkout,
			Name: "git",
			Args: []string{"rev-parse", "HEAD"},
		})
		if resolveErr != nil {
			if ctx.Err() != nil {
				return StatusCancelled, "", ""
			}
			return StatusFailed, "", fmt.Sprintf("Could not read the checked out commit: %v", resolveErr)
		}
		commitSHA = strings.TrimSpace(resolved)
	}

	m.setCommit(state, commitSHA)
	m.append(state, fmt.Sprintf("Checked out commit %s", commitSHA))

	dockerfilePath, contextDir, resolveErr := m.resolveBuildSource(state, workspace, checkout, subdirectory)
	if resolveErr != "" {
		return StatusFailed, "", resolveErr
	}

	m.append(state, fmt.Sprintf("Building image %s with BuildKit", state.request.ImageTag))
	buildErr := m.executor.Stream(ctx, exec.Options{
		Dir:  contextDir,
		Env:  []string{"DOCKER_BUILDKIT=1"},
		Name: "docker",
		Args: []string{
			"build",
			"--progress=plain",
			"--file", dockerfilePath,
			"--tag", state.request.ImageTag,
			".",
		},
	}, func(line string) { m.append(state, line) })
	if buildErr != nil {
		if ctx.Err() != nil {
			return StatusCancelled, "", ""
		}
		return StatusFailed, "", fmt.Sprintf("Build failed: %v", buildErr)
	}

	m.append(state, fmt.Sprintf("Built image %s", state.request.ImageTag))

	return StatusSucceeded, state.request.ImageTag, ""
}

func (m *Manager) append(state *buildState, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if state.status != StatusRunning {
		return
	}
	m.appendLocked(state, message)
}

func (m *Manager) appendLocked(state *buildState, message string) {
	state.logs = append(state.logs, LogEvent{
		Sequence:  len(state.logs) + 1,
		Message:   message,
		Timestamp: m.clock(),
	})
}

func (m *Manager) setCommit(state *buildState, commitSHA string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state.commitSHA = commitSHA
}

func (m *Manager) complete(state *buildState, status Status, imageRef, errMessage string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if state.status != StatusRunning {
		return
	}

	now := m.clock()
	state.status = status
	state.imageRef = imageRef
	state.err = errMessage
	state.finished = &now

	switch status {
	case StatusFailed:
		if errMessage != "" {
			m.appendLocked(state, errMessage)
		}
	case StatusCancelled:
		m.appendLocked(state, "Build cancelled")
	}

	close(state.done)
}

// pruneLocked drops the oldest finished Builds so a long-lived agent does not
// grow without bound. Running Builds are never removed.
func (m *Manager) pruneLocked() {
	if len(m.builds) < m.maxBuilds {
		return
	}

	for id, state := range m.builds {
		if state.status != StatusRunning {
			delete(m.builds, id)
			if len(m.builds) < m.maxBuilds {
				return
			}
		}
	}
}

func (s *buildState) snapshot() Snapshot {
	return Snapshot{
		BuildID:    s.request.BuildID,
		Status:     s.status,
		ImageRef:   s.imageRef,
		CommitSHA:  s.commitSHA,
		Error:      s.err,
		StartedAt:  s.startedAt,
		FinishedAt: s.finished,
	}
}

func (r Request) validate() error {
	switch {
	case strings.TrimSpace(r.BuildID) == "":
		return fmt.Errorf("%w: buildId is required", ErrInvalidRequest)
	case strings.TrimSpace(r.RepoURL) == "":
		return fmt.Errorf("%w: repoUrl is required", ErrInvalidRequest)
	case strings.TrimSpace(r.Branch) == "":
		return fmt.Errorf("%w: branch is required", ErrInvalidRequest)
	case strings.TrimSpace(r.ImageTag) == "":
		return fmt.Errorf("%w: imageTag is required", ErrInvalidRequest)
	case strings.TrimSpace(r.DockerfilePath) == "":
		return fmt.Errorf("%w: dockerfilePath is required", ErrInvalidRequest)
	}

	return nil
}

// normalizeRepoRequest turns a pasted repository page URL into the bare clone
// URL git needs, extracting the branch and the subfolder when the URL carries
// them. It returns the input unchanged when it is already a clone URL.
func normalizeRepoRequest(rawURL, branch string) (string, string, string) {
	trimmed := strings.TrimSpace(rawURL)
	trimmed = strings.TrimSuffix(trimmed, "/")
	trimmed = strings.TrimSuffix(trimmed, ".git")

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return rawURL, branch, ""
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")

	host := strings.ToLower(parsed.Host)
	// GitHub blob/tree URLs name the branch after /blob/ or /tree/; a "tree"
	// URL may also point at a subfolder, which becomes the project root.
	if isGitHub := host == "github.com" || host == "www.github.com"; isGitHub && len(segments) >= 4 && (segments[2] == "blob" || segments[2] == "tree") {
		if parsed.Scheme != "https" && parsed.Scheme != "http" {
			parsed.Scheme = "https"
		}
		clone := url.URL{Scheme: parsed.Scheme, Host: parsed.Host, Path: "/" + segments[0] + "/" + segments[1] + ".git"}
		subdirectory := ""
		pathSegments := segments[4:]
		// A blob URL points at a file, so only its parent folders are project
		// root; a tree URL already points at a folder.
		if segments[2] == "blob" && len(pathSegments) > 0 {
			pathSegments = pathSegments[:len(pathSegments)-1]
		}
		if len(pathSegments) > 0 {
			encoded := strings.Join(pathSegments, "/")
			if decoded, decodeErr := url.PathUnescape(encoded); decodeErr == nil {
				encoded = decoded
			}
			subdirectory = encoded
		}
		return clone.String(), segments[3], subdirectory
	}
	return rawURL, branch, ""
}

// resolveBuildSource decides which Dockerfile and build context a Build uses.
// A repository that ships a Dockerfile keeps the documented behaviour; one that
// does not gets a Dockerfile generated from its detected framework, the way a
// zero-config host builds a project. A non-empty error is user-facing.
func (m *Manager) resolveBuildSource(
	state *buildState,
	workspace, checkout, subdirectory string,
) (dockerfilePath, contextDir, failure string) {
	projectRoot := checkout
	if subdirectory != "" {
		candidate := filepath.Join(checkout, filepath.FromSlash(subdirectory))
		relative, relErr := filepath.Rel(checkout, candidate)
		if relErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return "", "", "The repository subfolder is outside the repository."
		}
		if info, statErr := os.Stat(candidate); statErr != nil || !info.IsDir() {
			return "", "", fmt.Sprintf("The repository subfolder %s does not exist.", subdirectory)
		}
		projectRoot = candidate
	}

	name := state.request.DockerfilePath
	if projectRoot != checkout && isFile(filepath.Join(projectRoot, name)) {
		return filepath.Join(projectRoot, name), projectRoot, ""
	}
	if isFile(filepath.Join(checkout, name)) {
		return filepath.Join(checkout, name), checkout, ""
	}

	// A custom Dockerfile path is an explicit instruction. Falling back to a
	// generated Dockerfile would silently build something the user did not ask
	// for, so only the default path may use zero-config.
	if name != defaultDockerfilePath {
		return "", "", fmt.Sprintf(
			"Dockerfile not found at %s. Fix the Dockerfile path or add the file to the repository.",
			name,
		)
	}

	generated, ok, detectErr := detectZeroConfig(projectRoot, state.request.ContainerPort)
	if detectErr != nil {
		return "", "", detectErr.Error()
	}
	if !ok {
		return "", "", fmt.Sprintf(
			"No Dockerfile found at %s and Stealth could not detect a framework it can build. "+
				"Add a Dockerfile to the repository, or point the repository URL at a subfolder with /tree/<branch>/<folder>.",
			name,
		)
	}

	// The generated file sits outside the build context so it never ends up in
	// the image it describes.
	generatedPath := filepath.Join(workspace, "Dockerfile.stealth")
	if writeErr := os.WriteFile(generatedPath, []byte(generated.Contents), 0o600); writeErr != nil {
		return "", "", fmt.Sprintf("Could not write the generated Dockerfile: %v", writeErr)
	}

	m.append(state, fmt.Sprintf(
		"No Dockerfile found; detected a %s and generated one at %s",
		generated.Framework, name,
	))
	return generatedPath, generated.ContextDir, ""
}
