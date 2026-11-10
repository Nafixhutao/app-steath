package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"stealth/agent/internal/build"
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
	Abort(ctx context.Context, request runtime.AbortRequest) (runtime.AbortResult, error)
	EnsureVolume(ctx context.Context, request runtime.VolumeRequest) (runtime.VolumeState, error)
	GetVolume(ctx context.Context, name string, sizeMB int) (runtime.VolumeState, error)
	RemoveVolume(ctx context.Context, name string) (bool, error)
	EnsureDatabase(ctx context.Context, request runtime.DatabaseRequest) (runtime.DatabaseState, error)
	GetDatabase(ctx context.Context, databaseID string, storageLimitMB int) (runtime.DatabaseState, error)
	RemoveDatabase(ctx context.Context, databaseID string) (bool, error)
	RotateDatabasePassword(
		ctx context.Context,
		request runtime.DatabasePasswordRequest,
	) (runtime.DatabaseState, error)
	EnsureDatabaseProxy(
		ctx context.Context,
		request runtime.DatabaseProxyRequest,
	) (runtime.DatabaseProxyState, error)
	GetDatabaseProxy(ctx context.Context, databaseID string) (runtime.DatabaseProxyState, error)
	RemoveDatabaseProxy(ctx context.Context, databaseID string) (bool, error)
	Backup(ctx context.Context, request runtime.BackupRequest) (runtime.BackupArtifact, error)
	BackupContent(backupID string) (string, int64, error)
	RemoveBackup(backupID string) (bool, error)
	AddHostname(
		ctx context.Context,
		serviceID string,
		hostname string,
	) (runtime.ServiceHostnameState, error)
	RemoveHostname(
		ctx context.Context,
		serviceID string,
		hostname string,
	) (runtime.ServiceHostnameState, error)
	Usage(ctx context.Context) (runtime.UsageReport, error)
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

	var volume *runtime.VolumeMount
	if request.Volume != nil {
		volume = &runtime.VolumeMount{
			Name:      request.Volume.Name,
			MountPath: request.Volume.MountPath,
			SizeMB:    request.Volume.SizeMb,
		}
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
		Volume:         volume,
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

// CancelDeployment aborts a Deployment: it stops the Build when it is still
// running and removes the container and image the attempt produced. It never
// touches the container that is already serving the Service.
func (s server) CancelDeployment(
	w http.ResponseWriter,
	r *http.Request,
	deploymentID DeploymentId,
) {
	var request CancelDeploymentRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The cancel request is not valid JSON.")
		return
	}
	if strings.TrimSpace(request.ServiceId) == "" {
		writeError(w, http.StatusBadRequest, "invalid_cancel_request", "serviceId is required.")
		return
	}

	buildCancelled := false
	if s.builds != nil {
		// An unknown Build is expected for a Deployment that never started one;
		// it is not an error, the cancel still has to clean up the runtime side.
		snapshot, err := s.builds.Cancel(deploymentID)
		switch {
		case err == nil:
			buildCancelled = snapshot.Status == build.StatusCancelled
		case !errors.Is(err, build.ErrUnknownBuild):
			writeError(w, http.StatusInternalServerError, "build_cancel_failed", err.Error())
			return
		}
	}

	abort := runtime.AbortResult{DeploymentID: deploymentID, ServiceID: request.ServiceId}
	if s.runtime != nil {
		result, err := s.runtime.Abort(r.Context(), runtime.AbortRequest{
			DeploymentID: deploymentID,
			ServiceID:    request.ServiceId,
			ImageRef:     deref(request.ImageRef),
		})
		if errors.Is(err, runtime.ErrInvalidDeploy) {
			writeError(w, http.StatusBadRequest, "invalid_cancel_request", err.Error())
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "deployment_cancel_failed", err.Error())
			return
		}
		abort = result
	}

	writeJSON(w, http.StatusOK, DeploymentAbort{
		DeploymentId:      abort.DeploymentID,
		ServiceId:         abort.ServiceID,
		BuildCancelled:    buildCancelled,
		ContainersRemoved: abort.ContainersRemoved,
		ImageRemoved:      abort.ImageRemoved,
	})
}

// EnsureVolume creates the Volume for a Service, or adopts the existing one, and
// answers with the usage the node measures. It is idempotent so a retried Deploy
// never replaces data.
func (s server) EnsureVolume(w http.ResponseWriter, r *http.Request, name VolumeName) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request VolumeRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The Volume request is not valid JSON.")
		return
	}

	state, err := s.runtime.EnsureVolume(r.Context(), runtime.VolumeRequest{
		Name:           name,
		ServiceID:      request.ServiceId,
		ProjectID:      request.ProjectId,
		OrganizationID: request.OrganizationId,
		DeploymentID:   deref(request.DeploymentId),
		SizeMB:         request.SizeMb,
	})
	if errors.Is(err, runtime.ErrInvalidDeploy) {
		writeError(w, http.StatusBadRequest, "invalid_volume_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "volume_create_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toVolumeInfo(state))
}

// GetVolume reports the Volume's limit and the space it uses.
func (s server) GetVolume(
	w http.ResponseWriter,
	r *http.Request,
	name VolumeName,
	params GetVolumeParams,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	sizeMB := runtime.MaxVolumeSizeMB
	if params.SizeMb != nil {
		sizeMB = *params.SizeMb
	}

	state, err := s.runtime.GetVolume(r.Context(), name, sizeMB)
	if errors.Is(err, runtime.ErrInvalidDeploy) {
		writeError(w, http.StatusBadRequest, "invalid_volume_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "volume_read_failed", err.Error())
		return
	}
	if !state.Exists {
		writeError(w, http.StatusNotFound, "volume_not_found", "The Volume does not exist on this node.")
		return
	}

	writeJSON(w, http.StatusOK, toVolumeInfo(state))
}

// RemoveVolume deletes a Volume and its data. A Volume that is already gone is
// reported as not removed rather than as an error.
func (s server) RemoveVolume(w http.ResponseWriter, r *http.Request, name VolumeName) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	removed, err := s.runtime.RemoveVolume(r.Context(), name)
	if errors.Is(err, runtime.ErrInvalidDeploy) {
		writeError(w, http.StatusBadRequest, "invalid_volume_request", err.Error())
		return
	}
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "in use") {
		writeError(
			w,
			http.StatusConflict,
			"volume_in_use",
			"Stop the Service before removing its Volume.",
		)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "volume_remove_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, VolumeRemoval{Name: name, Removed: removed})
}

// EnsureDatabase creates the Database container and its Volume on the Project
// network, or starts the existing one. It is idempotent, so a retried create
// never replaces the data or rewrites the credentials.
func (s server) EnsureDatabase(w http.ResponseWriter, r *http.Request, databaseID DatabaseId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request DatabaseRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The Database request is not valid JSON.")
		return
	}
	if request.DatabaseId != databaseID {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_database_request",
			"The databaseId in the path and the body must match.",
		)
		return
	}

	state, err := s.runtime.EnsureDatabase(r.Context(), runtime.DatabaseRequest{
		DatabaseID:     databaseID,
		ProjectID:      request.ProjectId,
		OrganizationID: request.OrganizationId,
		DatabaseName:   request.DatabaseName,
		Username:       request.Username,
		Password:       request.Password,
		StorageLimitMB: request.StorageLimitMb,
	})
	if errors.Is(err, runtime.ErrInvalidDatabase) {
		writeError(w, http.StatusBadRequest, "invalid_database_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_create_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toDatabaseState(state))
}

// GetDatabase reports the Database's health and the space its Volume uses.
func (s server) GetDatabase(
	w http.ResponseWriter,
	r *http.Request,
	databaseID DatabaseId,
	params GetDatabaseParams,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	storageLimitMB := runtime.MaxDatabaseStorageMB
	if params.StorageLimitMb != nil {
		storageLimitMB = *params.StorageLimitMb
	}

	state, err := s.runtime.GetDatabase(r.Context(), databaseID, storageLimitMB)
	if errors.Is(err, runtime.ErrInvalidDatabase) {
		writeError(w, http.StatusBadRequest, "invalid_database_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_read_failed", err.Error())
		return
	}
	if state.Status == "absent" {
		writeError(w, http.StatusNotFound, "database_not_found", "The Database does not exist on this node.")
		return
	}

	writeJSON(w, http.StatusOK, toDatabaseState(state))
}

// RemoveDatabase deletes the Database container and its Volume. A Database that
// is already gone is reported as not removed rather than as an error.
func (s server) RemoveDatabase(w http.ResponseWriter, r *http.Request, databaseID DatabaseId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	removed, err := s.runtime.RemoveDatabase(r.Context(), databaseID)
	if errors.Is(err, runtime.ErrInvalidDatabase) {
		writeError(w, http.StatusBadRequest, "invalid_database_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_remove_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, DatabaseRemoval{DatabaseId: databaseID, Removed: removed})
}

// RotateDatabasePassword replaces the password inside the running Database. The
// new password is only ever in the request body, never in a log or an error.
func (s server) RotateDatabasePassword(
	w http.ResponseWriter,
	r *http.Request,
	databaseID DatabaseId,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request DatabasePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The rotation request is not valid JSON.")
		return
	}

	state, err := s.runtime.RotateDatabasePassword(r.Context(), runtime.DatabasePasswordRequest{
		DatabaseID:   databaseID,
		DatabaseName: request.DatabaseName,
		Username:     request.Username,
		Password:     request.Password,
	})
	if errors.Is(err, runtime.ErrInvalidDatabase) {
		writeError(w, http.StatusBadRequest, "invalid_database_request", err.Error())
		return
	}
	if errors.Is(err, runtime.ErrUnknownDatabase) {
		writeError(w, http.StatusNotFound, "database_not_found", "The Database has no container on this node.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_rotate_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toDatabaseState(state))
}

// EnsureDatabaseProxy starts or updates the public TLS listener. The allowlist
// is validated by the runtime, which rejects an empty list so a public Database
// is never open to everyone by accident.
func (s server) EnsureDatabaseProxy(
	w http.ResponseWriter,
	r *http.Request,
	databaseID DatabaseId,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request EnsureDatabaseProxyJSONRequestBody
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The proxy request is not valid JSON.")
		return
	}
	if request.DatabaseId != databaseID {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_database_proxy_request",
			"The databaseId in the path and the body must match.",
		)
		return
	}

	state, err := s.runtime.EnsureDatabaseProxy(r.Context(), runtime.DatabaseProxyRequest{
		DatabaseID: databaseID,
		ProjectID:  request.ProjectId,
		Allowlist:  request.Allowlist,
		Port:       derefInt(request.Port),
	})
	if errors.Is(err, runtime.ErrInvalidDatabaseProxy) {
		writeError(w, http.StatusBadRequest, "invalid_database_proxy_request", err.Error())
		return
	}
	if errors.Is(err, runtime.ErrUnknownDatabase) {
		writeError(w, http.StatusNotFound, "database_not_found", "The Database has no running container on this node.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_proxy_enable_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toDatabaseProxyState(state))
}

// GetDatabaseProxy reports whether the public listener is running. A missing
// listener is a disabled proxy, not an error.
func (s server) GetDatabaseProxy(w http.ResponseWriter, r *http.Request, databaseID DatabaseId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.GetDatabaseProxy(r.Context(), databaseID)
	if errors.Is(err, runtime.ErrInvalidDatabaseProxy) {
		writeError(w, http.StatusBadRequest, "invalid_database_proxy_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_proxy_read_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toDatabaseProxyState(state))
}

// RemoveDatabaseProxy stops the public listener and revokes its endpoint. An
// already-disabled proxy is reported as not removed rather than as an error.
func (s server) RemoveDatabaseProxy(w http.ResponseWriter, r *http.Request, databaseID DatabaseId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	removed, err := s.runtime.RemoveDatabaseProxy(r.Context(), databaseID)
	if errors.Is(err, runtime.ErrInvalidDatabaseProxy) {
		writeError(w, http.StatusBadRequest, "invalid_database_proxy_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database_proxy_disable_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, DatabaseProxyRemoval{DatabaseId: databaseID, Removed: removed})
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

// GetUsage reports the current CPU, memory, and storage usage of every Service
// and Database on the node. The Control Plane stores the report as UsageSnapshots
// for the Quota dashboard.
func (s server) GetUsage(w http.ResponseWriter, r *http.Request) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	report, err := s.runtime.Usage(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "usage_read_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toUsageReport(report))
}

// CreateBackup produces the artifact for one Backup target. The bytes are
// downloaded separately so a large dump never travels inside JSON.
func (s server) CreateBackup(w http.ResponseWriter, r *http.Request) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request BackupRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The Backup request is not valid JSON.")
		return
	}

	artifact, err := s.runtime.Backup(r.Context(), runtime.BackupRequest{
		BackupID:      request.BackupId,
		TargetType:    string(request.TargetType),
		TargetID:      deref(request.TargetId),
		ContainerName: deref(request.ContainerName),
		DatabaseName:  deref(request.DatabaseName),
		Username:      deref(request.Username),
	})
	switch {
	case errors.Is(err, runtime.ErrInvalidBackup):
		writeError(w, http.StatusBadRequest, "invalid_backup_request", err.Error())
		return
	case errors.Is(err, runtime.ErrUnknownBackup):
		writeError(w, http.StatusNotFound, "backup_target_not_found", err.Error())
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "backup_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, BackupArtifact{
		BackupId:  artifact.BackupID,
		SizeBytes: artifact.SizeBytes,
	})
}

// GetBackupContent streams a Backup artifact the Control Plane is storing.
func (s server) GetBackupContent(w http.ResponseWriter, _ *http.Request, backupID BackupId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	path, size, err := s.runtime.BackupContent(string(backupID))
	if errors.Is(err, runtime.ErrUnknownBackup) {
		writeError(w, http.StatusNotFound, "backup_not_found", "Backup artifact not found.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "backup_read_failed", err.Error())
		return
	}

	file, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "backup_not_found", "Backup artifact not found.")
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, file); err != nil {
		log.Printf("stream Backup %s: %v", backupID, err)
	}
}

// RemoveBackup deletes an artifact once the Control Plane stored it.
func (s server) RemoveBackup(w http.ResponseWriter, _ *http.Request, backupID BackupId) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	removed, err := s.runtime.RemoveBackup(string(backupID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "backup_remove_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, BackupRemoval{BackupId: string(backupID), Removed: removed})
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

// AddServiceHostname points a verified Custom Domain at the running Service.
func (s server) AddServiceHostname(
	w http.ResponseWriter,
	r *http.Request,
	serviceID ServiceId,
	hostname Hostname,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.AddHostname(r.Context(), serviceID, hostname)
	if errors.Is(err, runtime.ErrInvalidHostname) {
		writeError(w, http.StatusBadRequest, "invalid_hostname", "The hostname is not a valid domain name.")
		return
	}
	if errors.Is(err, runtime.ErrUnknownService) {
		writeError(w, http.StatusNotFound, "service_not_running", "The Service has no container on this node.")
		return
	}
	if errors.Is(err, runtime.ErrServiceNotRunning) {
		writeError(w, http.StatusConflict, "service_not_running", "Deploy the Service before verifying its Custom Domain.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hostname_add_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceHostnameState(state))
}

// RemoveServiceHostname withdraws a Custom Domain route.
func (s server) RemoveServiceHostname(
	w http.ResponseWriter,
	r *http.Request,
	serviceID ServiceId,
	hostname Hostname,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	state, err := s.runtime.RemoveHostname(r.Context(), serviceID, hostname)
	if errors.Is(err, runtime.ErrInvalidHostname) {
		writeError(w, http.StatusBadRequest, "invalid_hostname", "The hostname is not a valid domain name.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hostname_remove_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toServiceHostnameState(state))
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

func toServiceHostnameState(state runtime.ServiceHostnameState) ServiceHostnameState {
	return ServiceHostnameState{
		ServiceId: state.ServiceID,
		Hostname:  state.Hostname,
		Routed:    state.Routed,
	}
}

func toUsageReport(report runtime.UsageReport) UsageReport {
	result := UsageReport{
		CapturedAt: report.CapturedAt,
		Services:   make([]ServiceUsage, 0, len(report.Services)),
		Databases:  make([]DatabaseUsage, 0, len(report.Databases)),
	}
	for _, service := range report.Services {
		result.Services = append(result.Services, ServiceUsage{
			ServiceId:     service.ServiceID,
			CpuUsage:      float32(service.CPUUsage),
			MemoryUsageMb: int(service.MemoryUsageMB),
			VolumeUsageMb: int(service.VolumeUsageMB),
		})
	}
	for _, database := range report.Databases {
		result.Databases = append(result.Databases, DatabaseUsage{
			DatabaseId: database.DatabaseID,
			UsageMb:    int(database.UsageMB),
		})
	}

	return result
}

func toVolumeInfo(state runtime.VolumeState) VolumeInfo {
	return VolumeInfo{
		Name:    state.Name,
		SizeMb:  state.SizeMB,
		UsageMb: state.UsageMB,
		Exists:  state.Exists,
	}
}

func toDatabaseState(state runtime.DatabaseState) DatabaseState {
	result := DatabaseState{
		DatabaseId:     state.DatabaseID,
		Status:         DatabaseStateStatus(state.Status),
		StorageLimitMb: state.StorageLimitMB,
		UsageMb:        state.UsageMB,
		Healthy:        state.Healthy,
		OverQuota:      &state.OverQuota,
	}
	if state.ContainerID != "" {
		result.ContainerId = &state.ContainerID
	}
	if state.Hostname != "" {
		result.Hostname = &state.Hostname
	}

	return result
}

func toDatabaseProxyState(state runtime.DatabaseProxyState) DatabaseProxyState {
	result := DatabaseProxyState{
		DatabaseId: state.DatabaseID,
		Enabled:    state.Enabled,
		Allowlist:  state.Allowlist,
	}
	if state.Port > 0 {
		port := state.Port
		result.Port = &port
	}

	return result
}

func deref(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}

	return *value
}

// timeNow is a variable so a test can pin timestamps.
var timeNow = func() time.Time { return time.Now().UTC() }
