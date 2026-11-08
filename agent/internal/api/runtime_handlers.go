package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"stealth/agent/internal/runtime"
)

// RuntimeDeployer is the subset of the runtime Manager the HTTP API needs.
type RuntimeDeployer interface {
	Deploy(ctx context.Context, request runtime.DeployRequest) (runtime.DeployResult, error)
	Stop(ctx context.Context, serviceID string) (runtime.ServiceState, error)
	Start(ctx context.Context, serviceID string) (runtime.ServiceState, error)
	Restart(ctx context.Context, serviceID string) (runtime.ServiceState, error)
	Remove(ctx context.Context, serviceID string) (runtime.ServiceState, error)
	State(ctx context.Context, serviceID string) (runtime.ServiceState, error)
	Logs(
		ctx context.Context,
		serviceID string,
		tail int,
		follow bool,
		onLine func(writtenAt time.Time, line string),
	) error
}

// DeployService runs a built image as the Service container and answers once the
// Deployment has either taken traffic or definitively failed.
func (s server) DeployService(w http.ResponseWriter, r *http.Request) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request DeployRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The Deploy request is not valid JSON.")
		return
	}

	environment := make(map[string]string)
	if request.EnvironmentVariables != nil {
		for _, variable := range *request.EnvironmentVariables {
			environment[variable.Name] = variable.Value
		}
	}

	cpuLimit := float64(request.CpuLimit)
	if cpuLimit <= 0 {
		cpuLimit = 0.5
	}

	result, err := s.runtime.Deploy(r.Context(), runtime.DeployRequest{
		DeploymentID:   request.DeploymentId,
		ServiceID:      request.ServiceId,
		ProjectID:      request.ProjectId,
		OrganizationID: request.OrganizationId,
		Hostname:       request.Hostname,
		ImageRef:       request.ImageRef,
		ContainerPort:  request.ContainerPort,
		HealthPath:     deref(request.HealthPath),
		CPULimit:       cpuLimit,
		MemoryLimitMB:  request.MemoryLimitMb,
		Environment:    environment,
	})
	if errors.Is(err, runtime.ErrInvalidDeploy) {
		writeError(w, http.StatusBadRequest, "invalid_deploy_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "deploy_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toDeployment(result))
}

// GetService reports the runtime state of one Service.
func (s server) GetService(w http.ResponseWriter, r *http.Request, serviceID ServiceId) {
	state, err := s.runtimeState(r.Context(), serviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "service_read_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceState(state))
}

// RemoveService deletes the container and its route.
func (s server) RemoveService(w http.ResponseWriter, r *http.Request, serviceID ServiceId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.Remove(r.Context(), serviceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "service_remove_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceState(state))
}

// StopService stops the container without removing it.
func (s server) StopService(w http.ResponseWriter, r *http.Request, serviceID ServiceId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.Stop(r.Context(), serviceID)
	if errors.Is(err, runtime.ErrUnknownService) {
		writeError(w, http.StatusNotFound, "service_not_running", "The Service has no container on this node.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "service_stop_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceState(state))
}

// StartService starts a previously stopped container.
func (s server) StartService(w http.ResponseWriter, r *http.Request, serviceID ServiceId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.Start(r.Context(), serviceID)
	if errors.Is(err, runtime.ErrUnknownService) {
		writeError(w, http.StatusNotFound, "service_not_running", "The Service has no container on this node.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "service_start_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceState(state))
}

// RestartService restarts the container without changing its configuration.
func (s server) RestartService(w http.ResponseWriter, r *http.Request, serviceID ServiceId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.Restart(r.Context(), serviceID)
	if errors.Is(err, runtime.ErrUnknownService) {
		writeError(w, http.StatusNotFound, "service_not_running", "The Service has no container on this node.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "service_restart_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceState(state))
}

// StreamServiceLogs follows the container output as newline-delimited JSON, so
// the dashboard can show runtime logs the same way it shows Build logs.
func (s server) StreamServiceLogs(
	w http.ResponseWriter,
	r *http.Request,
	serviceID ServiceId,
	params StreamServiceLogsParams,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported", "Streaming is unavailable.")
		return
	}

	tail := 200
	if params.Tail != nil {
		tail = *params.Tail
	}

	// Resolve the container before writing a status so an unknown Service still
	// gets a real 404 instead of an empty stream.
	if _, err := s.runtime.State(r.Context(), serviceID); err != nil {
		writeError(w, http.StatusInternalServerError, "service_read_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	encoder := json.NewEncoder(w)
	err := s.runtime.Logs(r.Context(), serviceID, tail, true, func(writtenAt time.Time, line string) {
		// The container's own timestamp is used, so the dashboard shows when the
		// application logged a line rather than when the agent read it.
		event := RuntimeLogEvent{Message: line, Timestamp: &writtenAt}

		if err := encoder.Encode(event); err != nil {
			return
		}
		flusher.Flush()
	})
	if errors.Is(err, runtime.ErrUnknownService) {
		// The container disappeared between the state check and the stream; the
		// status line is already sent, so just end the stream.
		return
	}
	if err != nil {
		log.Printf("stream runtime logs for %s: %v", serviceID, err)
	}
}

// runtimeState reads the state, tolerating an agent without a runtime so the
// endpoint still answers in unit tests and during a partial rollout.
func (s server) runtimeState(ctx context.Context, serviceID string) (runtime.ServiceState, error) {
	if s.runtime == nil {
		return runtime.ServiceState{ServiceID: serviceID, Status: "absent"}, nil
	}

	return s.runtime.State(ctx, serviceID)
}

func toDeployment(result runtime.DeployResult) Deployment {
	deployment := Deployment{
		DeploymentId: result.DeploymentID,
		ServiceId:    result.ServiceID,
		Status:       DeploymentStatus(result.Status),
	}
	if result.ContainerID != "" {
		deployment.ContainerId = &result.ContainerID
	}
	if result.Hostname != "" {
		deployment.Hostname = &result.Hostname
	}
	if result.Error != "" {
		deployment.Error = &result.Error
	}

	return deployment
}

func toServiceState(state runtime.ServiceState) ServiceState {
	result := ServiceState{
		ServiceId: state.ServiceID,
		Status:    ServiceStateStatus(state.Status),
	}
	if state.ContainerID != "" {
		result.ContainerId = &state.ContainerID
	}
	if state.DeploymentID != "" {
		result.DeploymentId = &state.DeploymentID
	}
	if state.Hostname != "" {
		result.Hostname = &state.Hostname
	}

	return result
}

func deref(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

// timeNow is a variable so a test can pin timestamps.
var timeNow = func() time.Time { return time.Now().UTC() }
