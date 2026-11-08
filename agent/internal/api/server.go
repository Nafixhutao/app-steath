package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"stealth/agent/internal/build"
)

// NodeInfoProvider reports the node details shown in the Control Plane.
type NodeInfoProvider interface {
	NodeInfo() NodeInfo
}

// server implements the generated ServerInterface.
type server struct {
	builds   *build.Manager
	nodeInfo NodeInfoProvider
	runtime  RuntimeDeployer
}

// NewHandler returns the versioned Node Agent API guarded by a bearer token.
func NewHandler(
	token string,
	builds *build.Manager,
	nodeInfo NodeInfoProvider,
	runtimeDeployer RuntimeDeployer,
) http.Handler {
	return authMiddleware(token, Handler(server{
		builds:   builds,
		nodeInfo: nodeInfo,
		runtime:  runtimeDeployer,
	}))
}

// GetHealth reports that the agent process is up. It never touches Docker, so
// the Control Plane can distinguish "agent down" from "Docker unhealthy".
func (server) GetHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, Health{Status: HealthStatusOk})
}

// GetNode reports Docker and BuildKit availability, which the Control Plane
// stores with each heartbeat.
func (s server) GetNode(w http.ResponseWriter, _ *http.Request) {
	if s.nodeInfo == nil {
		writeError(w, http.StatusInternalServerError, "node_info_unavailable", "Node info is unavailable.")
		return
	}

	writeJSON(w, http.StatusOK, s.nodeInfo.NodeInfo())
}

// StartBuild accepts a Build and returns immediately. The Build runs in the
// background so the Control Plane can stream its log.
func (s server) StartBuild(w http.ResponseWriter, r *http.Request) {
	var request BuildRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The Build request is not valid JSON.")
		return
	}

	snapshot, err := s.builds.Start(r.Context(), build.Request{
		BuildID:        request.BuildId,
		RepoURL:        request.RepoUrl,
		Branch:         request.Branch,
		DockerfilePath: request.DockerfilePath,
		ImageTag:       request.ImageTag,
		CommitSHA:      deref(request.CommitSha),
	})
	if errors.Is(err, build.ErrInvalidRequest) {
		writeError(w, http.StatusBadRequest, "invalid_build_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "build_start_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, toBuild(snapshot))
}

// GetBuild returns the current state of one Build.
func (s server) GetBuild(w http.ResponseWriter, _ *http.Request, buildID BuildId) {
	snapshot, err := s.builds.Get(buildID)
	if errors.Is(err, build.ErrUnknownBuild) {
		writeError(w, http.StatusNotFound, "build_not_found", "Build not found.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "build_read_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toBuild(snapshot))
}

// CancelBuild stops a running Build and returns its resulting state.
func (s server) CancelBuild(w http.ResponseWriter, _ *http.Request, buildID BuildId) {
	snapshot, err := s.builds.Cancel(buildID)
	if errors.Is(err, build.ErrUnknownBuild) {
		writeError(w, http.StatusNotFound, "build_not_found", "Build not found.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "build_cancel_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toBuild(snapshot))
}

// StreamBuildLogs writes newline-delimited log events and closes the response
// when the Build finishes. `after` makes a reconnect resume where it stopped.
func (s server) StreamBuildLogs(
	w http.ResponseWriter,
	r *http.Request,
	buildID BuildId,
	params StreamBuildLogsParams,
) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported", "Streaming is unavailable.")
		return
	}

	cursor := 0
	if params.After != nil {
		cursor = *params.After
	}

	// Reject unknown Builds before any bytes are written so the caller still
	// receives a JSON error with a real status code.
	if _, err := s.builds.Get(buildID); errors.Is(err, build.ErrUnknownBuild) {
		writeError(w, http.StatusNotFound, "build_not_found", "Build not found.")
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	encoder := json.NewEncoder(w)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		events, finished, err := s.builds.EventsSince(buildID, cursor)
		if err != nil {
			return
		}

		for _, event := range events {
			timestamp := event.Timestamp
			if err := encoder.Encode(BuildLogEvent{
				Sequence:  event.Sequence,
				Message:   event.Message,
				Timestamp: &timestamp,
			}); err != nil {
				return
			}
			cursor = event.Sequence
		}
		flusher.Flush()

		if finished {
			return
		}

		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func toBuild(snapshot build.Snapshot) Build {
	result := Build{
		BuildId: snapshot.BuildID,
		Status:  BuildStatus(snapshot.Status),
	}

	if snapshot.ImageRef != "" {
		imageRef := snapshot.ImageRef
		result.ImageRef = &imageRef
	}
	if snapshot.CommitSHA != "" {
		commitSha := snapshot.CommitSHA
		result.CommitSha = &commitSha
	}
	if snapshot.Error != "" {
		message := snapshot.Error
		result.Error = &message
	}
	if !snapshot.StartedAt.IsZero() {
		startedAt := snapshot.StartedAt
		result.StartedAt = &startedAt
	}
	if snapshot.FinishedAt != nil {
		finishedAt := *snapshot.FinishedAt
		result.FinishedAt = &finishedAt
	}

	return result
}

func authMiddleware(token string, next http.Handler) http.Handler {
	expected := "Bearer " + token

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		if subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Missing or invalid token.")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, Error{Error: message, Code: &code})
}
