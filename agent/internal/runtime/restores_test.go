package runtime

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestRestoreDatabaseLoadsTheDumpIntoTheOriginalDatabase(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetRestoreDir(t.TempDir())

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

	result, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-1",
		TargetType: RestoreTargetDatabase,
		TargetID:   "database-1",
	}, strings.NewReader("custom-format-dump"))
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if result.Status != "completed" || result.RestoreID != "restore-1" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(docker.restoredDatabases) != 1 ||
		docker.restoredDatabases[0] != "stealth-db-database-1 app app" {
		t.Fatalf("unexpected restore call: %+v", docker.restoredDatabases)
	}
}

func TestRestoreVolumeExtractsIntoTheOriginalVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetRestoreDir(t.TempDir())

	docker.volumes["stealth-vol-service-1"] = &fakeVolume{Name: "stealth-vol-service-1"}

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-2",
		TargetType: RestoreTargetVolume,
		TargetID:   "stealth-vol-service-1",
	}, strings.NewReader("compressed-tar")); err != nil {
		t.Fatalf("restore: %v", err)
	}

	if len(docker.restoredVolumes) != 1 || docker.restoredVolumes[0] != "stealth-vol-service-1" {
		t.Fatalf("unexpected restore call: %+v", docker.restoredVolumes)
	}
}

func TestRestoreFailureLeavesTheTargetAlone(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetRestoreDir(t.TempDir())

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
	docker.restoreDatabaseErr = errors.New("pg_restore: input file does not appear to be a valid archive")

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-3",
		TargetType: RestoreTargetDatabase,
		TargetID:   "database-1",
	}, strings.NewReader("not-a-dump")); err == nil {
		t.Fatal("expected the Restore to fail")
	}

	// The failed load never reaches the swap, so the Database container and its
	// labels are untouched.
	if _, ok := docker.containers["db-1"]; !ok {
		t.Fatal("the Database container was removed")
	}
	if len(docker.restoredDatabases) != 0 {
		t.Fatalf("a failed Restore was recorded as successful: %+v", docker.restoredDatabases)
	}
}

func TestRestoreRejectsInvalidRequests(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	// No Restore directory configured.
	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-4",
		TargetType: RestoreTargetVolume,
		TargetID:   "stealth-vol-service-1",
	}, strings.NewReader("bytes")); !errors.Is(err, ErrInvalidRestore) {
		t.Fatalf("expected ErrInvalidRestore without a directory, got %v", err)
	}

	manager.SetRestoreDir(t.TempDir())

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "../escape",
		TargetType: RestoreTargetVolume,
		TargetID:   "stealth-vol-service-1",
	}, strings.NewReader("bytes")); !errors.Is(err, ErrInvalidRestore) {
		t.Fatalf("expected ErrInvalidRestore for a path-like id, got %v", err)
	}

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-5",
		TargetType: "platform",
	}, strings.NewReader("bytes")); !errors.Is(err, ErrInvalidRestore) {
		t.Fatalf("expected ErrInvalidRestore for an unknown target, got %v", err)
	}

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-6",
		TargetType: RestoreTargetVolume,
		TargetID:   "missing-volume",
	}, strings.NewReader("bytes")); !errors.Is(err, ErrRestoreTargetNotFound) {
		t.Fatalf("expected ErrRestoreTargetNotFound for a missing Volume, got %v", err)
	}

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-7",
		TargetType: RestoreTargetDatabase,
		TargetID:   "missing-database",
	}, strings.NewReader("bytes")); !errors.Is(err, ErrRestoreTargetNotFound) {
		t.Fatalf("expected ErrRestoreTargetNotFound for a missing Database, got %v", err)
	}

	// An empty artifact is rejected before the target is touched.
	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-8",
		TargetType: RestoreTargetVolume,
		TargetID:   "missing-volume",
	}, strings.NewReader("")); !errors.Is(err, ErrInvalidRestore) {
		t.Fatalf("expected ErrInvalidRestore for an empty artifact, got %v", err)
	}
}

func TestRestoreRemovesTheStagedArtifact(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	dir := t.TempDir()
	manager.SetRestoreDir(dir)

	docker.volumes["stealth-vol-service-1"] = &fakeVolume{Name: "stealth-vol-service-1"}

	if _, err := manager.Restore(context.Background(), RestoreRequest{
		RestoreID:  "restore-9",
		TargetType: RestoreTargetVolume,
		TargetID:   "stealth-vol-service-1",
	}, strings.NewReader("bytes")); err != nil {
		t.Fatalf("restore: %v", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read the Restore directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected the staged artifact to be removed, found %d files", len(entries))
	}
}
