package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"stealth/agent/internal/build"
	"stealth/agent/internal/exec"
)

// stubExecutor records the commands a Build would run and lets each test decide
// what happens, so the API tests never touch Docker.
type stubExecutor struct {
	mu     sync.Mutex
	builds int
	fail   bool
}

func (s *stubExecutor) Stream(
	ctx context.Context,
	options exec.Options,
	onLine func(string),
) error {
	s.mu.Lock()
	if options.Name == "docker" {
		s.builds++
	}
	fail := s.fail
	s.mu.Unlock()

	if options.Name == "git" {
		// The Manager inspects the checkout for the Dockerfile afterwards.
		checkout := options.Args[len(options.Args)-1]
		if err := os.MkdirAll(checkout, 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(checkout, "Dockerfile"), []byte("FROM busybox\n"), 0o600); err != nil {
			return err
		}
		onLine("Cloning into src")
		return nil
	}
	if fail {
		onLine("error: failed to solve")
		return context.Canceled
	}

	onLine("exporting layers")
	return nil
}

func (s *stubExecutor) Output(ctx context.Context, options exec.Options) (string, error) {
	return "abc123\n", nil
}

func (s *stubExecutor) OutputToFile(ctx context.Context, options exec.Options, path string) error {
	return os.WriteFile(path, []byte("backup-bytes"), 0o600)
}

func (s *stubExecutor) RunFile(ctx context.Context, options exec.Options, path string) error {
	return nil
}

type stubNodeInfo struct{ info NodeInfo }

func (s stubNodeInfo) NodeInfo() NodeInfo { return s.info }

func newNodeInfo() stubNodeInfo {
	name := "node-1"
	cpu := 2
	memory := 4096
	return stubNodeInfo{info: NodeInfo{
		Name:              &name,
		Status:            NodeInfoStatusOk,
		DockerVersion:     "29.9.2",
		BuildkitAvailable: true,
		CpuCount:          &cpu,
		MemoryMb:          &memory,
	}}
}

func newTestHandler(t *testing.T, executor *stubExecutor) http.Handler {
	t.Helper()

	manager := build.NewManager(t.TempDir(), executor)
	return NewHandler("test-token", manager, newNodeInfo(), nil)
}

func authorized(method, path string, body string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}

	request := httptest.NewRequest(method, path, reader)
	request.Header.Set("Authorization", "Bearer test-token")
	request.Header.Set("Content-Type", "application/json")

	return request
}

func TestHealthReturnsOKWithValidToken(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	request := authorized(http.MethodGet, "/v1/health", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}

	var body Health
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}

	if body.Status != HealthStatusOk {
		t.Fatalf("expected status %q, got %q", HealthStatusOk, body.Status)
	}
}

func TestHealthRejectsMissingToken(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	request := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, response.Code)
	}
}

func TestNodeReportsDockerAndBuildKit(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	request := authorized(http.MethodGet, "/v1/node", "")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}

	var body NodeInfo
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode node response: %v", err)
	}

	if body.DockerVersion != "29.9.2" {
		t.Fatalf("expected the Docker version, got %q", body.DockerVersion)
	}
	if !body.BuildkitAvailable {
		t.Fatal("expected BuildKit to be reported as available")
	}
}

const buildRequest = `{
	"buildId": "deployment-1",
	"repoUrl": "https://example.test/repo.git",
	"branch": "main",
	"dockerfilePath": "Dockerfile",
	"imageTag": "stealth/service:deployment-1"
}`

func TestStartBuildReturnsAcceptedAndFinishes(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, authorized(http.MethodPost, "/v1/builds", buildRequest))

	if response.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d: %s", http.StatusAccepted, response.Code, response.Body.String())
	}

	var body Build
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode build response: %v", err)
	}
	if body.BuildId != "deployment-1" {
		t.Fatalf("expected the deployment id, got %q", body.BuildId)
	}

	finished := waitForBuild(t, handler, "deployment-1", BuildStatusSucceeded)
	if finished.ImageRef == nil || *finished.ImageRef != "stealth/service:deployment-1" {
		t.Fatalf("expected the image reference, got %v", finished.ImageRef)
	}
}

func TestStartBuildRejectsInvalidBody(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, authorized(http.MethodPost, "/v1/builds", `{"buildId":""}`))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, response.Code)
	}
}

func TestGetBuildReportsUnknownBuild(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, authorized(http.MethodGet, "/v1/builds/missing", ""))

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, response.Code)
	}
}

func TestBuildFailureIsReported(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{fail: true})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, authorized(http.MethodPost, "/v1/builds", buildRequest))
	if response.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, response.Code)
	}

	failed := waitForBuild(t, handler, "deployment-1", BuildStatusFailed)
	if failed.Error == nil || !strings.Contains(*failed.Error, "Build failed") {
		t.Fatalf("expected a failure message, got %v", failed.Error)
	}
}

func TestStreamBuildLogsReturnsEvents(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	start := httptest.NewRecorder()
	handler.ServeHTTP(start, authorized(http.MethodPost, "/v1/builds", buildRequest))
	if start.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, start.Code)
	}

	server := httptest.NewServer(handler)
	defer server.Close()

	request, err := http.NewRequest(http.MethodGet, server.URL+"/v1/builds/deployment-1/logs", nil)
	if err != nil {
		t.Fatalf("build log request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer test-token")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("stream logs: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.StatusCode)
	}

	var messages []string
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		var event BuildLogEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatalf("decode log event: %v", err)
		}
		messages = append(messages, event.Message)
	}

	joined := strings.Join(messages, "\n")
	if !strings.Contains(joined, "Cloning into src") {
		t.Fatalf("expected the clone output in the log, got %q", joined)
	}
	if !strings.Contains(joined, "exporting layers") {
		t.Fatalf("expected the builder output in the log, got %q", joined)
	}
}

func TestCancelBuildReturnsTheBuild(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	start := httptest.NewRecorder()
	handler.ServeHTTP(start, authorized(http.MethodPost, "/v1/builds", buildRequest))
	if start.Code != http.StatusAccepted {
		t.Fatalf("expected status %d, got %d", http.StatusAccepted, start.Code)
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, authorized(http.MethodDelete, "/v1/builds/deployment-1", ""))

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, response.Code, response.Body.String())
	}

	var body Build
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode cancel response: %v", err)
	}
	if body.BuildId != "deployment-1" {
		t.Fatalf("expected the deployment id, got %q", body.BuildId)
	}
}

func TestCancelUnknownBuildIsNotFound(t *testing.T) {
	handler := newTestHandler(t, &stubExecutor{})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, authorized(http.MethodDelete, "/v1/builds/missing", ""))

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, response.Code)
	}
}

// waitForBuild polls the API until the Build reaches the wanted status.
func waitForBuild(t *testing.T, handler http.Handler, buildID string, want BuildStatus) Build {
	t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, authorized(http.MethodGet, "/v1/builds/"+buildID, ""))
		if response.Code != http.StatusOK {
			t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
		}

		var body Build
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode build response: %v", err)
		}
		if body.Status == want {
			return body
		}

		time.Sleep(5 * time.Millisecond)
	}

	t.Fatalf("build did not reach %q", want)
	return Build{}
}
