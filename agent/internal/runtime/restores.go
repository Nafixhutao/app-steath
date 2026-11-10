package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
)

// Restore target types the Node Agent knows how to restore. The platform
// PostgreSQL is not restorable in this experiment.
const (
	RestoreTargetDatabase = "database"
	RestoreTargetVolume   = "volume"
)

// ErrInvalidRestore is returned for a Restore request the agent cannot honour.
var ErrInvalidRestore = errors.New("invalid restore request")

// ErrRestoreTargetNotFound is returned when the Database or Volume is not on
// this node.
var ErrRestoreTargetNotFound = errors.New("restore target not found")

// RestoreRequest describes one Restore. TargetID is a Database id or a Docker
// Volume name, matching the Backup that is being restored.
type RestoreRequest struct {
	RestoreID  string
	TargetType string
	TargetID   string
}

// RestoreResult is the answer once the data work finished.
type RestoreResult struct {
	RestoreID string
	Status    string
}

// SetRestoreDir configures where an incoming artifact is staged while it is
// restored. Without a directory, Restore requests fail rather than writing
// somewhere unexpected.
func (m *Manager) SetRestoreDir(dir string) {
	m.restoreDir = dir
}

// Restore stages the artifact body, applies it to the original target, and
// removes the staged file. The body is streamed to disk so a large Backup never
// has to fit in memory.
func (m *Manager) Restore(
	ctx context.Context,
	request RestoreRequest,
	body io.Reader,
) (RestoreResult, error) {
	if !backupIDPattern.MatchString(request.RestoreID) {
		return RestoreResult{}, fmt.Errorf("%w: restoreId is not valid", ErrInvalidRestore)
	}
	if m.restoreDir == "" {
		return RestoreResult{}, fmt.Errorf("%w: the agent has no Restore directory", ErrInvalidRestore)
	}
	if body == nil {
		return RestoreResult{}, fmt.Errorf("%w: the Backup artifact is missing", ErrInvalidRestore)
	}

	if err := os.MkdirAll(m.restoreDir, 0o750); err != nil {
		return RestoreResult{}, fmt.Errorf("prepare the Restore directory: %w", err)
	}

	file, err := os.CreateTemp(m.restoreDir, "restore-*.artifact")
	if err != nil {
		return RestoreResult{}, fmt.Errorf("stage the Backup artifact: %w", err)
	}
	path := file.Name()
	defer func() {
		_ = file.Close()
		_ = os.Remove(path)
	}()

	written, copyErr := io.Copy(file, body)
	closeErr := file.Close()
	if copyErr != nil {
		return RestoreResult{}, fmt.Errorf("stage the Backup artifact: %w", copyErr)
	}
	if closeErr != nil {
		return RestoreResult{}, fmt.Errorf("stage the Backup artifact: %w", closeErr)
	}
	if written == 0 {
		return RestoreResult{}, fmt.Errorf("%w: the Backup artifact is empty", ErrInvalidRestore)
	}

	switch request.TargetType {
	case RestoreTargetDatabase:
		containerName := databaseContainerName(request.TargetID)
		info, err := m.docker.InspectContainer(ctx, containerName)
		if err != nil {
			return RestoreResult{}, fmt.Errorf(
				"%w: Database %s is not on this node",
				ErrRestoreTargetNotFound,
				request.TargetID,
			)
		}
		databaseName := info.Labels[LabelDatabaseName]
		username := info.Labels[LabelDatabaseUsername]
		if databaseName == "" || username == "" {
			return RestoreResult{}, fmt.Errorf(
				"%w: Database %s has no restore metadata",
				ErrInvalidRestore,
				request.TargetID,
			)
		}
		if !info.Running() {
			return RestoreResult{}, fmt.Errorf(
				"%w: Database %s is not running",
				ErrInvalidRestore,
				request.TargetID,
			)
		}

		if err := m.docker.RestoreDatabase(ctx, containerName, databaseName, username, path); err != nil {
			return RestoreResult{}, fmt.Errorf("restore Database %s: %w", request.TargetID, err)
		}
	case RestoreTargetVolume:
		if request.TargetID == "" {
			return RestoreResult{}, fmt.Errorf("%w: targetId is required for a Volume Restore", ErrInvalidRestore)
		}
		_, exists, err := m.docker.VolumeUsage(ctx, request.TargetID)
		if err != nil {
			return RestoreResult{}, fmt.Errorf("inspect Volume %s: %w", request.TargetID, err)
		}
		if !exists {
			return RestoreResult{}, fmt.Errorf(
				"%w: Volume %s is not on this node",
				ErrRestoreTargetNotFound,
				request.TargetID,
			)
		}

		if err := m.docker.RestoreVolume(ctx, request.TargetID, path); err != nil {
			return RestoreResult{}, fmt.Errorf("restore Volume %s: %w", request.TargetID, err)
		}
	default:
		return RestoreResult{}, fmt.Errorf("%w: unknown targetType %q", ErrInvalidRestore, request.TargetType)
	}

	return RestoreResult{RestoreID: request.RestoreID, Status: "completed"}, nil
}
