package runtime

import (
	"context"
	"strings"
	"testing"
)

func databaseRequest() DatabaseRequest {
	return DatabaseRequest{
		DatabaseID:     "database-1",
		ProjectID:      "project-1",
		OrganizationID: "org-1",
		DatabaseName:   "app",
		Username:       "app",
		Password:       "0123456789abcdef",
		StorageLimitMB: 1024,
	}
}

func TestEnsureDatabaseCreatesAPrivateContainerAndVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	state, err := manager.EnsureDatabase(context.Background(), databaseRequest())
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if state.Status != "running" || !state.Healthy {
		t.Fatalf("unexpected Database state: %+v", state)
	}
	if state.Hostname != DatabaseAlias {
		t.Fatalf("expected the %q alias, got %q", DatabaseAlias, state.Hostname)
	}

	if len(docker.created) != 1 {
		t.Fatalf("expected one container, got %d", len(docker.created))
	}
	spec := docker.created[0]
	if spec.Image != DatabaseImage {
		t.Fatalf("expected %s, got %s", DatabaseImage, spec.Image)
	}
	if spec.Network != "stealth-project-project-1" {
		t.Fatalf("expected the Project network, got %s", spec.Network)
	}
	if spec.NetworkAlias != DatabaseAlias {
		t.Fatalf("expected the %q alias, got %q", DatabaseAlias, spec.NetworkAlias)
	}
	if spec.User != DatabaseUser {
		t.Fatalf("expected the Database to run as %q, got %q", DatabaseUser, spec.User)
	}
	if spec.Volume == nil {
		t.Fatal("expected the Database to have its own Volume")
	}
	if spec.Volume.Name != "stealth-dbvol-database-1" {
		t.Fatalf("unexpected Volume name: %s", spec.Volume.Name)
	}
	if spec.Volume.MountPath != DatabaseMountPath {
		t.Fatalf("unexpected mount path: %s", spec.Volume.MountPath)
	}
	if spec.Labels[LabelType] != ResourceTypeDatabase {
		t.Fatalf("expected the Database label, got %q", spec.Labels[LabelType])
	}
	if spec.Labels[LabelDatabaseID] != "database-1" {
		t.Fatalf("expected the Database id label, got %q", spec.Labels[LabelDatabaseID])
	}
	if spec.Environment["POSTGRES_PASSWORD"] != "0123456789abcdef" {
		t.Fatal("expected the password to reach the container environment")
	}

	// The Volume must be labelled so cleanup can find it after a restart.
	if volume, ok := docker.volumes["stealth-dbvol-database-1"]; !ok {
		t.Fatal("expected the Database Volume to exist")
	} else if volume.Labels[LabelType] != ResourceTypeDatabase {
		t.Fatalf("expected the Database Volume label, got %q", volume.Labels[LabelType])
	}
}

func TestEnsureDatabaseIsIdempotent(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("second ensure: %v", err)
	}

	if len(docker.created) != 1 {
		t.Fatalf("expected the second call to adopt the container, got %d created", len(docker.created))
	}
}

func TestGetDatabaseReportsAbsentWhenThereIsNoContainer(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	state, err := manager.GetDatabase(context.Background(), "database-1", 1024)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if state.Status != "absent" {
		t.Fatalf("expected absent, got %q", state.Status)
	}
	if state.StorageLimitMB != 1024 {
		t.Fatalf("expected the configured limit to be echoed, got %d", state.StorageLimitMB)
	}
}

func TestRotateDatabasePasswordUsesStdinAndNeverTheArguments(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	newPassword := "fedcba9876543210"
	if _, err := manager.RotateDatabasePassword(context.Background(), DatabasePasswordRequest{
		DatabaseID:   "database-1",
		DatabaseName: "app",
		Username:     "app",
		Password:     newPassword,
	}); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	var rotate *fakeExec
	for index := range docker.execCalls {
		call := docker.execCalls[index]
		if len(call.Command) > 0 && call.Command[0] == "psql" {
			rotate = &docker.execCalls[index]
		}
	}
	if rotate == nil {
		t.Fatal("expected psql to be executed inside the Database")
	}
	for _, argument := range rotate.Command {
		if strings.Contains(argument, newPassword) {
			t.Fatalf("the password leaked into the process arguments: %v", rotate.Command)
		}
	}
	if !strings.Contains(rotate.Stdin, "ALTER ROLE") {
		t.Fatalf("expected ALTER ROLE on stdin, got %q", rotate.Stdin)
	}
	if !strings.Contains(rotate.Stdin, newPassword) {
		t.Fatal("expected the new password on stdin")
	}
}

func TestRotateDatabasePasswordRedactsAFailure(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	docker.execErr = errEchoingPassword("0123456789abcdef")

	_, err := manager.RotateDatabasePassword(context.Background(), DatabasePasswordRequest{
		DatabaseID:   "database-1",
		DatabaseName: "app",
		Username:     "app",
		Password:     "0123456789abcdef",
	})
	if err == nil {
		t.Fatal("expected the rotation to fail")
	}
	if strings.Contains(err.Error(), "0123456789abcdef") {
		t.Fatalf("the password leaked into the error: %v", err)
	}
}

func TestRemoveDatabaseDeletesTheContainerAndVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	removed, err := manager.RemoveDatabase(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if !removed {
		t.Fatal("expected the Database to be reported as removed")
	}
	if _, ok := docker.find("stealth-db-database-1"); ok {
		t.Fatal("expected the container to be gone")
	}
	if _, ok := docker.volumes["stealth-dbvol-database-1"]; ok {
		t.Fatal("expected the Volume to be gone")
	}

	// A retried cleanup must not fail.
	if again, err := manager.RemoveDatabase(context.Background(), "database-1"); err != nil || again {
		t.Fatalf("expected an idempotent remove, got removed=%t err=%v", again, err)
	}
}

func TestEnforceDatabasesStopsAnOverQuotaContainer(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	docker.volumes["stealth-dbvol-database-1"].UsageMB = MaxDatabaseStorageMB + 1

	stopped, err := manager.EnforceDatabases(context.Background())
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	if stopped != 1 {
		t.Fatalf("expected one Database to be stopped, got %d", stopped)
	}
	if container, _ := docker.find("stealth-db-database-1"); container.State != "exited" {
		t.Fatalf("expected the Database to be stopped, got %q", container.State)
	}
}

func TestEnforceDatabasesLeavesADatabaseUnderItsLimitAlone(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}
	docker.volumes["stealth-dbvol-database-1"].UsageMB = MaxDatabaseStorageMB - 1

	stopped, err := manager.EnforceDatabases(context.Background())
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	if stopped != 0 {
		t.Fatalf("expected nothing to be stopped, got %d", stopped)
	}
	if container, _ := docker.find("stealth-db-database-1"); container.State != "running" {
		t.Fatalf("expected the Database to keep running, got %q", container.State)
	}
}

func TestCleanupKeepsALiveDatabaseVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetCleanupStatePath(t.TempDir() + "/cleanup.json")

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	if _, err := manager.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if _, ok := docker.volumes["stealth-dbvol-database-1"]; !ok {
		t.Fatal("expected the live Database Volume to survive cleanup")
	}
}

func TestCleanupRemovesAnOrphanDatabaseVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetCleanupStatePath(t.TempDir() + "/cleanup.json")

	docker.volumes["stealth-dbvol-database-1"] = &fakeVolume{
		Name:   "stealth-dbvol-database-1",
		Labels: map[string]string{LabelType: ResourceTypeDatabase, LabelDatabaseID: "database-1"},
	}

	if _, err := manager.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if _, ok := docker.volumes["stealth-dbvol-database-1"]; ok {
		t.Fatal("expected the orphan Database Volume to be removed")
	}
}

func TestDatabaseRequestRejectsUnsafeValues(t *testing.T) {
	cases := map[string]func(*DatabaseRequest){
		"missing id":       func(r *DatabaseRequest) { r.DatabaseID = "" },
		"missing project":  func(r *DatabaseRequest) { r.ProjectID = "" },
		"missing org":      func(r *DatabaseRequest) { r.OrganizationID = "" },
		"unsafe db name":   func(r *DatabaseRequest) { r.DatabaseName = "app; DROP TABLE x" },
		"unsafe username":  func(r *DatabaseRequest) { r.Username = "app--" },
		"empty password":   func(r *DatabaseRequest) { r.Password = "" },
		"too much storage": func(r *DatabaseRequest) { r.StorageLimitMB = MaxDatabaseStorageMB + 1 },
		"no storage":       func(r *DatabaseRequest) { r.StorageLimitMB = 0 },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			request := databaseRequest()
			mutate(&request)
			if err := request.validate(); err == nil {
				t.Fatal("expected the request to be rejected")
			}
		})
	}
}

type passwordEchoError string

func (e passwordEchoError) Error() string { return string(e) }

func errEchoingPassword(password string) error {
	return passwordEchoError("psql: could not alter role: " + password)
}
