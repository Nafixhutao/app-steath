package runtime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// Backup target types the Node Agent knows how to produce.
const (
	BackupTargetDatabase = "database"
	BackupTargetVolume   = "volume"
	BackupTargetPlatform = "platform"
)

// ErrInvalidBackup is returned for a Backup request the agent cannot honour.
var ErrInvalidBackup = errors.New("invalid backup request")

// ErrUnknownBackup is returned when an artifact is not (or no longer) on disk.
var ErrUnknownBackup = errors.New("unknown backup")

// backupIDPattern keeps a Backup id usable as a file name without escaping the
// agent work directory.
var backupIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// BackupRequest describes one artifact the Control Plane wants the node to
// produce. Database Backups read the container labels, so the agent needs only
// the Database id. A platform Backup names the container and role explicitly
// because the platform PostgreSQL is not a managed Database.
type BackupRequest struct {
	BackupID      string
	TargetType    string
	TargetID      string
	ContainerName string
	DatabaseName  string
	Username      string
}

// BackupArtifact is the metadata the Control Plane stores before downloading the
// bytes. The file stays in the agent work directory until it is removed.
type BackupArtifact struct {
	BackupID  string
	SizeBytes int64
}

// backupExtension is the file extension the artifact for an engine uses. The
// Control Plane stores the file as-is, so the extension is what tells a Restore
// which tool produced it.
func backupExtension(engine string) string {
	if engine == DatabaseEngineMySQL {
		return ".sql"
	}

	return ".backup"
}

// backupArtifacts tracks the file each Backup id produced. A map is needed
// because a Database backup and a Volume archive have different extensions.
type backupArtifacts struct {
	mu    sync.Mutex
	paths map[string]string
}

// SetBackupDir configures where Backup artifacts are written. Without a
// directory, Backup requests fail rather than writing somewhere unexpected.
func (m *Manager) SetBackupDir(dir string) {
	m.backupDir = dir
}

// Backup produces the artifact for one target and returns its size. It is
// idempotent: asking for the same Backup id twice reuses the existing file.
func (m *Manager) Backup(ctx context.Context, request BackupRequest) (BackupArtifact, error) {
	if !backupIDPattern.MatchString(request.BackupID) {
		return BackupArtifact{}, fmt.Errorf("%w: backupId is not valid", ErrInvalidBackup)
	}
	if m.backupDir == "" {
		return BackupArtifact{}, fmt.Errorf("%w: the agent has no Backup directory", ErrInvalidBackup)
	}

	if existing, ok := m.backupArtifacts.path(request.BackupID); ok {
		info, err := os.Stat(existing)
		if err == nil {
			return BackupArtifact{BackupID: request.BackupID, SizeBytes: info.Size()}, nil
		}
	}

	if err := os.MkdirAll(m.backupDir, 0o750); err != nil {
		return BackupArtifact{}, fmt.Errorf("prepare the Backup directory: %w", err)
	}

	path := filepath.Join(m.backupDir, sanitizeID(request.BackupID))
	switch request.TargetType {
	case BackupTargetDatabase:
		// A Database is a schema inside the shared server, not a container of
		// its own, so the dump runs against the shared container and names the
		// tenant schema explicitly.
		engine := m.engineForDatabase(ctx, request.TargetID)
		containerName := sharedServerFor(engine).Name
		info, err := m.docker.InspectContainer(ctx, containerName)
		if err != nil {
			return BackupArtifact{}, fmt.Errorf("%w: Database %s is not on this node", ErrUnknownBackup, request.TargetID)
		}
		if !info.Running() {
			return BackupArtifact{}, fmt.Errorf("%w: Database %s is not running", ErrInvalidBackup, request.TargetID)
		}

		schema := schemaNameFor(request.TargetID)
		username := m.databaseRole(ctx, engine, request.TargetID)

		// MySQL writes a plain SQL dump and PostgreSQL a custom-format one, so the
		// artifact keeps the extension the matching Restore expects.
		path += backupExtension(engine)
		if err := m.docker.DumpDatabase(ctx, containerName, schema, username, engine, path); err != nil {
			return BackupArtifact{}, fmt.Errorf("back up Database %s: %w", request.TargetID, err)
		}
	case BackupTargetVolume:
		if request.TargetID == "" {
			return BackupArtifact{}, fmt.Errorf("%w: targetId is required for a Volume Backup", ErrInvalidBackup)
		}

		path += ".tar.gz"
		if err := m.docker.ArchiveVolume(ctx, request.TargetID, path); err != nil {
			return BackupArtifact{}, fmt.Errorf("archive Volume %s: %w", request.TargetID, err)
		}
	case BackupTargetPlatform:
		if request.ContainerName == "" || request.DatabaseName == "" || request.Username == "" {
			return BackupArtifact{}, fmt.Errorf(
				"%w: a platform Backup needs containerName, databaseName, and username",
				ErrInvalidBackup,
			)
		}

		path += ".backup"
		if err := m.docker.DumpDatabase(
			ctx,
			request.ContainerName,
			request.DatabaseName,
			request.Username,
			DatabaseEnginePostgres,
			path,
		); err != nil {
			return BackupArtifact{}, fmt.Errorf("back up the platform PostgreSQL: %w", err)
		}
	default:
		return BackupArtifact{}, fmt.Errorf("%w: unknown targetType %q", ErrInvalidBackup, request.TargetType)
	}

	info, err := os.Stat(path)
	if err != nil {
		return BackupArtifact{}, fmt.Errorf("read the Backup artifact: %w", err)
	}
	if info.Size() == 0 {
		_ = os.Remove(path)
		return BackupArtifact{}, fmt.Errorf("the Backup artifact is empty")
	}

	m.backupArtifacts.remember(request.BackupID, path)

	return BackupArtifact{BackupID: request.BackupID, SizeBytes: info.Size()}, nil
}

// BackupContent returns the path and size of an artifact so the API can stream
// it without loading the whole file into memory.
func (m *Manager) BackupContent(backupID string) (string, int64, error) {
	path, ok := m.backupArtifacts.path(backupID)
	if !ok {
		return "", 0, ErrUnknownBackup
	}

	info, err := os.Stat(path)
	if err != nil {
		m.backupArtifacts.forget(backupID)
		return "", 0, ErrUnknownBackup
	}

	return path, info.Size(), nil
}

// RemoveBackup deletes the artifact after the Control Plane stored it.
func (m *Manager) RemoveBackup(backupID string) (bool, error) {
	path, ok := m.backupArtifacts.path(backupID)
	if !ok {
		return false, nil
	}

	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	m.backupArtifacts.forget(backupID)

	return true, nil
}

func (a *backupArtifacts) path(backupID string) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()

	path, ok := a.paths[backupID]
	return path, ok
}

func (a *backupArtifacts) remember(backupID, path string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.paths[backupID] = path
}

func (a *backupArtifacts) forget(backupID string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	delete(a.paths, backupID)
}
