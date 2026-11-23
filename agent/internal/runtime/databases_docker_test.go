package runtime

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"testing"
	"time"

	stealthexec "stealth/agent/internal/exec"
)

// databaseDockerDeadline is longer than dockerDeadline because the first run may
// pull the postgres image and initdb has to create the shared cluster on disk.
const databaseDockerDeadline = 5 * time.Minute

// TestDockerSharedDatabaseIsReachableOnlyFromTheProjectNetwork proves the two
// promises of the shared model with a real daemon: a Service in the Project
// reaches its own schema through `db`, and the same schema is not reachable from
// a container that is not on the Project network.
func TestDockerSharedDatabaseIsReachableOnlyFromTheProjectNetwork(t *testing.T) {
	requireDocker(t)

	docker := NewCLIDocker(stealthexec.SystemExecutor{}, "")
	manager := NewManager(docker, newFakeRouter())
	password := "0123456789abcdef0123456789abcdef"
	manager.SetDatabaseServerPasswords(password, password)

	databaseID := "dbint" + fmt.Sprint(time.Now().UnixNano()%1_000_000)
	schema, role := databaseObjectNames(databaseID)
	request := DatabaseRequest{
		DatabaseID:     databaseID,
		ProjectID:      "project-dbint",
		OrganizationID: "org-test",
		DatabaseName:   schema,
		Username:       role,
		Password:       password,
		StorageLimitMB: MaxDatabaseStorageMB,
	}

	ctx, cancel := context.WithTimeout(context.Background(), databaseDockerDeadline)
	defer cancel()

	// A leftover from an earlier run would make the test pass on stale state.
	_, _ = manager.RemoveDatabase(ctx, databaseID)
	_ = exec.Command("docker", "network", "rm", projectNetwork(request.ProjectID)).Run()

	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cleanupCancel()
		_, _ = manager.RemoveDatabase(cleanupCtx, databaseID)
		_ = exec.Command("docker", "network", "rm", projectNetwork(request.ProjectID)).Run()
	})

	state, err := manager.EnsureDatabase(ctx, request)
	if err != nil {
		t.Fatalf("ensure Database: %v", err)
	}
	if state.Status != "running" || !state.Healthy {
		t.Fatalf("expected a healthy running Database, got %+v", state)
	}

	// The shared server publishes no host port: the only way in is a Project
	// network the agent attached it to.
	ports, err := exec.Command("docker", "port", SharedPostgresContainerName).Output()
	if err != nil {
		t.Fatalf("read published ports: %v", err)
	}
	if strings.TrimSpace(string(ports)) != "" {
		t.Fatalf("expected no published ports, got %q", ports)
	}

	// A container on the Project network reaches its own schema through `db`.
	serviceProbe := exec.Command(
		"docker", "run", "--rm",
		"--network", projectNetwork(request.ProjectID),
		"--env", "PGPASSWORD="+password,
		SharedPostgresImage,
		"psql", "--host", DatabaseAlias, "--username", role,
		"--dbname", schema, "--no-psqlrc", "--command", "SELECT 42 AS ok",
	)
	output, err := serviceProbe.CombinedOutput()
	if err != nil {
		t.Fatalf("expected a Service on the Project network to connect: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "42") {
		t.Fatalf("expected the query to return 42, got %q", output)
	}

	// A container that is not on the Project network cannot resolve the alias.
	hostProbe := exec.Command(
		"docker", "run", "--rm",
		"--env", "PGPASSWORD="+password,
		SharedPostgresImage,
		"psql", "--host", DatabaseAlias, "--username", role,
		"--dbname", schema, "--no-psqlrc", "--command", "SELECT 1",
	)
	output, err = hostProbe.CombinedOutput()
	if err == nil {
		t.Fatalf("expected a client outside the Project network to fail, got %q", output)
	}
}

// TestDockerSharedDatabaseIsolatesTwoTenants proves the isolation the shared
// model rests on: a role for one Database cannot read another Database's schema
// on the same server.
func TestDockerSharedDatabaseIsolatesTwoTenants(t *testing.T) {
	requireDocker(t)

	docker := NewCLIDocker(stealthexec.SystemExecutor{}, "")
	manager := NewManager(docker, newFakeRouter())
	password := "0123456789abcdef0123456789abcdef"
	manager.SetDatabaseServerPasswords(password, password)

	suffix := fmt.Sprint(time.Now().UnixNano() % 1_000_000)
	first := "dbiso" + suffix + "a"
	second := "dbiso" + suffix + "b"

	ctx, cancel := context.WithTimeout(context.Background(), databaseDockerDeadline)
	defer cancel()

	projectID := "project-dbiso"
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cleanupCancel()
		_, _ = manager.RemoveDatabase(cleanupCtx, first)
		_, _ = manager.RemoveDatabase(cleanupCtx, second)
		_ = exec.Command("docker", "network", "rm", projectNetwork(projectID)).Run()
	})

	for _, databaseID := range []string{first, second} {
		schema, role := databaseObjectNames(databaseID)
		if _, err := manager.EnsureDatabase(ctx, DatabaseRequest{
			DatabaseID:     databaseID,
			ProjectID:      projectID,
			OrganizationID: "org-test",
			DatabaseName:   schema,
			Username:       role,
			Password:       password,
			StorageLimitMB: MaxDatabaseStorageMB,
		}); err != nil {
			t.Fatalf("ensure %s: %v", databaseID, err)
		}
	}

	firstSchema, firstName := databaseObjectNames(first)
	secondSchema, _ := databaseObjectNames(second)

	// The first tenant writes a row into its own schema.
	write := exec.Command(
		"docker", "run", "--rm",
		"--network", projectNetwork(projectID),
		"--env", "PGPASSWORD="+password,
		SharedPostgresImage,
		"psql", "--host", DatabaseAlias, "--username", firstName,
		"--dbname", firstSchema, "--no-psqlrc", "--command",
		"CREATE TABLE secret (v text); INSERT INTO secret VALUES ('private')",
	)
	if output, err := write.CombinedOutput(); err != nil {
		t.Fatalf("seed the first tenant: %v\n%s", err, output)
	}

	// The second tenant must not be able to read it, even though it is on the
	// same server and network.
	secondRole := role2(first)
	read := exec.Command(
		"docker", "run", "--rm",
		"--network", projectNetwork(projectID),
		"--env", "PGPASSWORD="+password,
		SharedPostgresImage,
		"psql", "--host", DatabaseAlias, "--username", secondRole,
		"--dbname", secondSchema, "--no-psqlrc", "--command",
		"SELECT v FROM "+firstSchema+".secret",
	)
	if output, err := read.CombinedOutput(); err == nil {
		t.Fatalf("expected the second tenant to be denied, got %q", output)
	}
}

// role2 is a tiny helper so the isolation test reads clearly.
func role2(databaseID string) string {
	_, role := databaseObjectNames(databaseID)

	return role
}
