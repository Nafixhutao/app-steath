package runtime

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// A Project Database is one PostgreSQL container on the Project network. It has
// its own Volume and no published host port, so only Services in the same
// Project can reach it. The Control Plane owns the credentials; the agent only
// sees them in the request body and passes them to the container.
const (
	// DatabaseImage is the only engine the spec allows.
	DatabaseImage = "postgres:16-alpine"

	// DatabasePort and DatabaseAlias are what a Service connects to. The alias
	// stays the same for every Project, because each Project has its own network.
	DatabasePort  = 5432
	DatabaseAlias = "db"

	// DatabaseMountPath is where PostgreSQL keeps its data. PGDATA is a
	// subdirectory so the Volume root can hold the entrypoint's lock files too.
	DatabaseMountPath = "/var/lib/postgresql/data"
	DatabasePGDATA    = DatabaseMountPath + "/pgdata"

	// MaxDatabaseStorageMB is the spec limit for one Project Database.
	MaxDatabaseStorageMB = 1024

	// DatabaseCPULimit and DatabaseMemoryMB keep one Database from consuming the
	// whole node, matching the per-Service limits.
	DatabaseCPULimit = 0.5
	DatabaseMemoryMB = 512

	// DatabaseUser is the unprivileged owner of the data directory. Running as
	// it means the image entrypoint never needs root or extra capabilities.
	DatabaseUser = "postgres"

	// databaseReadyTimeout is longer than a Service health check because the
	// first start runs initdb, which has to create the cluster on disk.
	databaseReadyTimeout = 2 * time.Minute
)

// ErrUnknownDatabase is returned when a Database has no container on this node.
var ErrUnknownDatabase = errors.New("unknown database")

// ErrInvalidDatabase is returned for a Database request that cannot be honoured.
var ErrInvalidDatabase = errors.New("invalid database request")

// DatabaseRequest describes the Database container the Control Plane wants.
type DatabaseRequest struct {
	DatabaseID     string
	ProjectID      string
	OrganizationID string
	DatabaseName   string
	Username       string
	Password       string
	StorageLimitMB int
}

// DatabasePasswordRequest replaces the password of a running Database.
type DatabasePasswordRequest struct {
	DatabaseID   string
	DatabaseName string
	Username     string
	Password     string
}

// DatabaseState is what the Control Plane reads back about a Database.
type DatabaseState struct {
	DatabaseID     string
	Status         string
	ContainerID    string
	Hostname       string
	StorageLimitMB int
	UsageMB        int64
	Healthy        bool
	OverQuota      bool
}

// EnsureDatabase creates the Database container and its Volume, or starts and
// adopts them when they already exist. It is idempotent: a retried create never
// replaces the data or rewrites the credentials of an existing cluster.
func (m *Manager) EnsureDatabase(ctx context.Context, request DatabaseRequest) (DatabaseState, error) {
	if err := request.validate(); err != nil {
		return DatabaseState{}, err
	}

	unlock := m.lockService(databaseLockKey(request.DatabaseID))
	defer unlock()

	network := projectNetwork(request.ProjectID)
	if err := m.docker.EnsureNetwork(ctx, network); err != nil {
		return DatabaseState{}, fmt.Errorf("could not prepare the Project network: %w", err)
	}

	if err := m.ensureDatabaseVolume(ctx, request); err != nil {
		return DatabaseState{}, err
	}

	containerName := databaseContainerName(request.DatabaseID)
	info, err := m.docker.InspectContainer(ctx, containerName)
	if err == nil {
		if info.Labels[LabelDatabaseID] != request.DatabaseID {
			return DatabaseState{}, fmt.Errorf(
				"%w: container %s is owned by another Database",
				ErrInvalidDatabase,
				containerName,
			)
		}

		if !info.OnNetwork(network) {
			if err := m.docker.ConnectNetwork(ctx, network, info.ID, DatabaseAlias); err != nil {
				return DatabaseState{}, fmt.Errorf("could not attach the Database to the Project network: %w", err)
			}
		}
		if !info.Running() {
			if err := m.docker.StartContainer(ctx, info.ID); err != nil {
				return DatabaseState{}, fmt.Errorf("could not start the Database: %w", err)
			}
		}

		if err := m.waitDatabaseReady(ctx, info.ID, request.Username, request.DatabaseName); err != nil {
			return DatabaseState{}, err
		}

		return m.databaseState(ctx, request.DatabaseID, request.StorageLimitMB)
	}

	spec := ContainerSpec{
		Name:         containerName,
		Network:      network,
		NetworkAlias: DatabaseAlias,
		Image:        DatabaseImage,
		Port:         DatabasePort,
		CPU:          DatabaseCPULimit,
		MemoryMB:     DatabaseMemoryMB,
		User:         DatabaseUser,
		Environment: map[string]string{
			"POSTGRES_DB":       request.DatabaseName,
			"POSTGRES_USER":     request.Username,
			"POSTGRES_PASSWORD": request.Password,
			"PGDATA":            DatabasePGDATA,
		},
		Volume: &VolumeMount{
			Name:      databaseVolumeName(request.DatabaseID),
			MountPath: DatabaseMountPath,
			SizeMB:    request.StorageLimitMB,
		},
		// PostgreSQL writes outside its Volume (socket and lock files), so the
		// root filesystem is not read-only for this container.
		ReadOnlyRoot: false,
		Labels: map[string]string{
			LabelType:              ResourceTypeDatabase,
			LabelOrganizationID:    request.OrganizationID,
			LabelProjectID:         request.ProjectID,
			LabelDatabaseID:        request.DatabaseID,
			LabelDatabaseName:      request.DatabaseName,
			LabelDatabaseUsername:  request.Username,
			LabelDatabaseStorageMb: strconv.Itoa(request.StorageLimitMB),
			LabelPort:              strconv.Itoa(DatabasePort),
			LabelAlias:             DatabaseAlias,
		},
	}

	containerID, err := m.docker.CreateContainer(ctx, spec)
	if err != nil {
		return DatabaseState{}, fmt.Errorf("could not start the Database container: %w", err)
	}

	if err := m.waitDatabaseReady(ctx, containerID, request.Username, request.DatabaseName); err != nil {
		_ = m.docker.RemoveContainer(ctx, containerID, true)
		return DatabaseState{}, err
	}

	return m.databaseState(ctx, request.DatabaseID, request.StorageLimitMB)
}

// GetDatabase reports a Database's health and storage usage. A Database whose
// container is gone answers `absent` instead of an error, because the Control
// Plane still has a row for it and the dashboard has to show the real state.
func (m *Manager) GetDatabase(
	ctx context.Context,
	databaseID string,
	storageLimitMB int,
) (DatabaseState, error) {
	if strings.TrimSpace(databaseID) == "" {
		return DatabaseState{}, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	}

	return m.databaseState(ctx, databaseID, storageLimitMB)
}

// RemoveDatabase deletes the Database container and its Volume. A Database that
// is already gone counts as removed, so a retried cleanup never fails.
func (m *Manager) RemoveDatabase(ctx context.Context, databaseID string) (bool, error) {
	if strings.TrimSpace(databaseID) == "" {
		return false, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	}

	unlock := m.lockService(databaseLockKey(databaseID))
	defer unlock()

	removed := false
	if info, err := m.docker.InspectContainer(ctx, databaseContainerName(databaseID)); err == nil {
		_ = m.docker.StopContainer(ctx, info.ID)
		if err := m.docker.RemoveContainer(ctx, info.ID, true); err != nil {
			return removed, err
		}
		removed = true
	}

	volumeRemoved, err := m.docker.RemoveVolume(ctx, databaseVolumeName(databaseID))
	if err != nil {
		return removed, err
	}

	return removed || volumeRemoved, nil
}

// RotateDatabasePassword changes the role password inside the running cluster.
// The new password travels on standard input, never in the command arguments,
// so it does not appear in the host process list or in an error message.
func (m *Manager) RotateDatabasePassword(
	ctx context.Context,
	request DatabasePasswordRequest,
) (DatabaseState, error) {
	if err := request.validate(); err != nil {
		return DatabaseState{}, err
	}

	unlock := m.lockService(databaseLockKey(request.DatabaseID))
	defer unlock()

	info, err := m.docker.InspectContainer(ctx, databaseContainerName(request.DatabaseID))
	if err != nil {
		return DatabaseState{}, ErrUnknownDatabase
	}
	if !info.Running() {
		return DatabaseState{}, fmt.Errorf("%w: the Database container is not running", ErrInvalidDatabase)
	}

	statement := fmt.Sprintf(
		"ALTER ROLE %s WITH PASSWORD %s;\n",
		quoteIdentifier(request.Username),
		quoteLiteral(request.Password),
	)
	command := []string{
		"psql",
		"--username", request.Username,
		"--dbname", request.DatabaseName,
		"--no-psqlrc",
		"--set", "ON_ERROR_STOP=1",
	}
	if _, err := m.docker.Exec(ctx, info.ID, command, statement); err != nil {
		// psql can echo a failing statement. The password must never reach the
		// Control Plane's Deployment error or the dashboard.
		return DatabaseState{}, errors.New(redactSecret(err.Error(), request.Password))
	}

	storageLimitMB, _ := strconv.Atoi(info.Labels[LabelDatabaseStorageMb])
	return m.databaseState(ctx, request.DatabaseID, storageLimitMB)
}

// EnforceDatabases stops a Database whose Volume grew past its storage limit.
// Docker's local driver cannot enforce a per-Volume quota, so the node measures
// and reacts instead of letting one Database fill the VPS disk.
func (m *Manager) EnforceDatabases(ctx context.Context) (int, error) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabase})
	if err != nil {
		return 0, err
	}

	stopped := 0
	for _, container := range containers {
		if !container.Running() {
			continue
		}

		databaseID := container.Labels[LabelDatabaseID]
		if databaseID == "" {
			continue
		}
		storageLimitMB, err := strconv.Atoi(container.Labels[LabelDatabaseStorageMb])
		if err != nil || storageLimitMB <= 0 {
			continue
		}

		usage, exists, err := m.docker.VolumeUsage(ctx, databaseVolumeName(databaseID))
		if err != nil || !exists || usage <= int64(storageLimitMB) {
			continue
		}

		log.Printf(
			"database %s uses %d MB, over its %d MB limit; stopping the Database",
			databaseID,
			usage,
			storageLimitMB,
		)
		if err := m.docker.StopContainer(ctx, container.ID); err != nil {
			log.Printf("database %s: could not stop the over-quota container: %v", databaseID, err)
			continue
		}
		stopped++
	}

	return stopped, nil
}

// ensureDatabaseVolume creates the Database Volume and labels it with its
// owners, so cleanup can find it after a restart without the Control Plane.
func (m *Manager) ensureDatabaseVolume(ctx context.Context, request DatabaseRequest) error {
	labels := map[string]string{
		LabelType:           ResourceTypeDatabase,
		LabelOrganizationID: request.OrganizationID,
		LabelProjectID:      request.ProjectID,
		LabelDatabaseID:     request.DatabaseID,
	}

	if err := m.docker.EnsureVolume(ctx, VolumeSpec{
		Name:   databaseVolumeName(request.DatabaseID),
		SizeMB: request.StorageLimitMB,
		Labels: labels,
	}); err != nil {
		return fmt.Errorf("could not prepare the Database Volume: %w", err)
	}

	return nil
}

// waitDatabaseReady polls `pg_isready` until PostgreSQL accepts connections or
// the container exits. A running process that is still running initdb is not
// healthy yet, which is why the port alone is not enough.
func (m *Manager) waitDatabaseReady(
	ctx context.Context,
	containerID string,
	username string,
	databaseName string,
) error {
	deadline := m.clock().Add(databaseReadyTimeout)
	var lastError string

	for {
		_, err := m.docker.Exec(ctx, containerID, []string{
			"pg_isready",
			"--username", username,
			"--dbname", databaseName,
		}, "")
		if err == nil {
			return nil
		}
		lastError = err.Error()

		info, inspectErr := m.docker.InspectContainer(ctx, containerID)
		if inspectErr == nil && info.State == "exited" {
			return errors.New("The Database container exited before it became ready.")
		}

		if !m.clock().Before(deadline) {
			return fmt.Errorf(
				"The Database did not become ready within %s: %s",
				databaseReadyTimeout,
				strings.TrimSpace(lastError),
			)
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("The Database readiness check was interrupted: %w", ctx.Err())
		case <-time.After(m.pollInterval):
		}
	}
}

// databaseState reads the container and Volume and derives the health the
// dashboard shows.
func (m *Manager) databaseState(
	ctx context.Context,
	databaseID string,
	storageLimitMB int,
) (DatabaseState, error) {
	if storageLimitMB <= 0 {
		storageLimitMB = MaxDatabaseStorageMB
	}

	info, err := m.docker.InspectContainer(ctx, databaseContainerName(databaseID))
	if err != nil {
		return DatabaseState{
			DatabaseID:     databaseID,
			Status:         "absent",
			StorageLimitMB: storageLimitMB,
		}, nil
	}

	if labelLimit, err := strconv.Atoi(info.Labels[LabelDatabaseStorageMb]); err == nil && labelLimit > 0 {
		storageLimitMB = labelLimit
	}

	usage, exists, err := m.docker.VolumeUsage(ctx, databaseVolumeName(databaseID))
	if err != nil {
		return DatabaseState{}, err
	}
	if !exists {
		usage = 0
	}

	status := "stopped"
	healthy := false
	if info.Running() {
		status = "running"
		_, healthErr := m.docker.Exec(ctx, info.ID, []string{
			"pg_isready",
			"--username", info.Labels[LabelDatabaseUsername],
			"--dbname", info.Labels[LabelDatabaseName],
		}, "")
		healthy = healthErr == nil
	} else if info.State == "dead" {
		status = "failed"
	}

	return DatabaseState{
		DatabaseID:     databaseID,
		Status:         status,
		ContainerID:    info.ID,
		Hostname:       DatabaseAlias,
		StorageLimitMB: storageLimitMB,
		UsageMB:        usage,
		Healthy:        healthy,
		OverQuota:      usage > int64(storageLimitMB),
	}, nil
}

// reconcileDatabases re-attaches Database containers to their Project network
// after an agent restart. Docker keeps the attachment in the normal case, so
// this only repairs a node whose network was removed.
func (m *Manager) reconcileDatabases(ctx context.Context) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabase})
	if err != nil {
		log.Printf("reconcile databases: %v", err)
		return
	}

	for _, container := range containers {
		databaseID := container.Labels[LabelDatabaseID]
		projectID := container.Labels[LabelProjectID]
		if databaseID == "" || projectID == "" {
			continue
		}

		network := projectNetwork(projectID)
		if err := m.docker.EnsureNetwork(ctx, network); err != nil {
			log.Printf("reconcile database %s: could not ensure %s: %v", databaseID, network, err)
			continue
		}
		if container.OnNetwork(network) {
			continue
		}
		if err := m.docker.ConnectNetwork(ctx, network, container.ID, DatabaseAlias); err != nil {
			log.Printf("reconcile database %s: could not attach it to %s: %v", databaseID, network, err)
		}
	}
}

// pruneOrphanDatabaseVolumes removes a Database Volume whose container is gone.
// A stopped Database keeps its container, so its Volume is never mistaken for an
// orphan.
func (m *Manager) pruneOrphanDatabaseVolumes(ctx context.Context) (int, error) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabase})
	if err != nil {
		return 0, err
	}

	live := make(map[string]bool, len(containers))
	for _, container := range containers {
		if databaseID := container.Labels[LabelDatabaseID]; databaseID != "" {
			live[databaseID] = true
		}
	}

	volumes, err := m.docker.ListVolumes(ctx, map[string]string{LabelType: ResourceTypeDatabase})
	if err != nil {
		return 0, err
	}

	removed := 0
	for _, volume := range volumes {
		databaseID := volume.Labels[LabelDatabaseID]
		if databaseID != "" && live[databaseID] {
			continue
		}
		if _, err := m.docker.RemoveVolume(ctx, volume.Name); err != nil {
			log.Printf("cleanup: could not remove orphan Database Volume %s: %v", volume.Name, err)
			continue
		}
		removed++
	}

	return removed, nil
}

func databaseContainerName(databaseID string) string {
	return "stealth-db-" + sanitizeID(databaseID)
}

func databaseVolumeName(databaseID string) string {
	return "stealth-dbvol-" + sanitizeID(databaseID)
}

func databaseLockKey(databaseID string) string {
	return "database:" + databaseID
}

// databaseNamePattern matches a PostgreSQL identifier. The Control Plane always
// uses `app`, but the agent still rejects anything that could break a SQL
// statement or a container argument.
var databaseNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)

func (r DatabaseRequest) validate() error {
	switch {
	case strings.TrimSpace(r.DatabaseID) == "":
		return fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	case strings.TrimSpace(r.ProjectID) == "":
		return fmt.Errorf("%w: projectId is required", ErrInvalidDatabase)
	case strings.TrimSpace(r.OrganizationID) == "":
		return fmt.Errorf("%w: organizationId is required", ErrInvalidDatabase)
	case !databaseNamePattern.MatchString(r.DatabaseName):
		return fmt.Errorf("%w: databaseName is not a valid PostgreSQL identifier", ErrInvalidDatabase)
	case !databaseNamePattern.MatchString(r.Username):
		return fmt.Errorf("%w: username is not a valid PostgreSQL identifier", ErrInvalidDatabase)
	case !validPassword(r.Password):
		return fmt.Errorf("%w: password must be between 1 and 256 bytes and contain no NUL", ErrInvalidDatabase)
	case r.StorageLimitMB <= 0 || r.StorageLimitMB > MaxDatabaseStorageMB:
		return fmt.Errorf("%w: storageLimitMb must be between 1 and %d", ErrInvalidDatabase, MaxDatabaseStorageMB)
	}

	return nil
}

func (r DatabasePasswordRequest) validate() error {
	switch {
	case strings.TrimSpace(r.DatabaseID) == "":
		return fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	case !databaseNamePattern.MatchString(r.DatabaseName):
		return fmt.Errorf("%w: databaseName is not a valid PostgreSQL identifier", ErrInvalidDatabase)
	case !databaseNamePattern.MatchString(r.Username):
		return fmt.Errorf("%w: username is not a valid PostgreSQL identifier", ErrInvalidDatabase)
	case !validPassword(r.Password):
		return fmt.Errorf("%w: password must be between 1 and 256 bytes and contain no NUL", ErrInvalidDatabase)
	}

	return nil
}

func validPassword(value string) bool {
	return value != "" && len(value) <= 256 && !strings.ContainsRune(value, '\x00')
}

// quoteIdentifier quotes a PostgreSQL identifier, so a name can never break out
// of the ALTER ROLE statement.
func quoteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

// quoteLiteral quotes a PostgreSQL string literal. Passwords generated by the
// Control Plane are hex, but doubling a quote keeps this safe for any value.
func quoteLiteral(value string) string {
	return `'` + strings.ReplaceAll(value, `'`, `''`) + `'`
}

// redactSecret replaces a secret in an error message so a tool that echoes its
// input cannot leak it.
func redactSecret(message string, secret string) string {
	if secret == "" {
		return message
	}

	return strings.ReplaceAll(message, secret, "***")
}
