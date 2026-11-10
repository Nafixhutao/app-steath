package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestBackupDatabaseDumpsThroughItsContainer(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetBackupDir(t.TempDir())

	docker.containers["db-1"] = &fakeContainer{
		ID:    "db-1",
		Name:  "stealth-db-database-1",
		State: "running",
		Labels: map[string]string{
			LabelType:             ResourceTypeDatabase,
			LabelDatabaseID:       "database-1",
			LabelDatabaseName:     "app",
			LabelDatabaseUsername: "app",
		},
	}

	artifact, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:   "backup-1",
		TargetType: BackupTargetDatabase,
		TargetID:   "database-1",
	})
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if artifact.BackupID != "backup-1" || artifact.SizeBytes == 0 {
		t.Fatalf("unexpected artifact: %+v", artifact)
	}
	if len(docker.dumped) != 1 || docker.dumped[0] != "stealth-db-database-1 app app" {
		t.Fatalf("unexpected dump call: %+v", docker.dumped)
	}

	path, size, err := manager.BackupContent("backup-1")
	if err != nil {
		t.Fatalf("content: %v", err)
	}
	if size != artifact.SizeBytes || filepath.Ext(path) != ".dump" {
		t.Fatalf("unexpected content %s (%d bytes)", path, size)
	}

	removed, err := manager.RemoveBackup("backup-1")
	if err != nil || !removed {
		t.Fatalf("remove: %v %v", removed, err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected the artifact to be gone, got %v", err)
	}
}

func TestBackupVolumeArchivesTheDockerVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetBackupDir(t.TempDir())

	artifact, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:   "backup-2",
		TargetType: BackupTargetVolume,
		TargetID:   "stealth-vol-service-1",
	})
	if err != nil {
		t.Fatalf("backup: %v", err)
	}
	if artifact.SizeBytes == 0 {
		t.Fatal("expected a non-empty archive")
	}
	if len(docker.archived) != 1 || docker.archived[0] != "stealth-vol-service-1" {
		t.Fatalf("unexpected archive call: %+v", docker.archived)
	}

	path, _, err := manager.BackupContent("backup-2")
	if err != nil {
		t.Fatalf("content: %v", err)
	}
	if filepath.Ext(path) != ".gz" {
		t.Fatalf("expected a gzip archive, got %s", path)
	}
}

func TestBackupPlatformDumpsTheNamedContainer(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetBackupDir(t.TempDir())

	if _, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:      "backup-3",
		TargetType:    BackupTargetPlatform,
		ContainerName: "stealth-postgres",
		DatabaseName:  "stealth_hosting",
		Username:      "stealth",
	}); err != nil {
		t.Fatalf("backup: %v", err)
	}

	if len(docker.dumped) != 1 || docker.dumped[0] != "stealth-postgres stealth_hosting stealth" {
		t.Fatalf("unexpected dump call: %+v", docker.dumped)
	}
}

func TestBackupRejectsInvalidAndUnknownTargets(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:   "backup-4",
		TargetType: BackupTargetVolume,
		TargetID:   "stealth-vol-service-1",
	}); !errors.Is(err, ErrInvalidBackup) {
		t.Fatalf("expected ErrInvalidBackup without a directory, got %v", err)
	}

	manager.SetBackupDir(t.TempDir())

	if _, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:   "../escape",
		TargetType: BackupTargetVolume,
		TargetID:   "stealth-vol-service-1",
	}); !errors.Is(err, ErrInvalidBackup) {
		t.Fatalf("expected ErrInvalidBackup for a path-like id, got %v", err)
	}

	if _, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:   "backup-5",
		TargetType: BackupTargetDatabase,
		TargetID:   "missing",
	}); !errors.Is(err, ErrUnknownBackup) {
		t.Fatalf("expected ErrUnknownBackup for a missing Database, got %v", err)
	}

	if _, err := manager.Backup(context.Background(), BackupRequest{
		BackupID:   "backup-6",
		TargetType: "bucket",
	}); !errors.Is(err, ErrInvalidBackup) {
		t.Fatalf("expected ErrInvalidBackup for an unknown target, got %v", err)
	}

	if _, _, err := manager.BackupContent("backup-5"); !errors.Is(err, ErrUnknownBackup) {
		t.Fatalf("expected ErrUnknownBackup for content, got %v", err)
	}
}
