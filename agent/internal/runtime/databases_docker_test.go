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
// pull the postgres image and initdb has to create the cluster on disk.
const databaseDockerDeadline = 5 * time.Minute

// TestDockerDatabaseIsReachableOnlyFromTheProjectNetwork proves the two promises
// the ticket makes about isolation: a Service in the same Project can connect
// through the `db` alias, and nothing outside the Project network can.
func TestDockerDatabaseIsReachableOnlyFromTheProjectNetwork(t *testing.T) {
	requireDocker(t)

	docker := NewCLIDocker(stealthexec.SystemExecutor{}, "")
	manager := NewManager(docker, newFakeRouter())

	request := DatabaseRequest{
		DatabaseID:     "dbint" + fmt.Sprint(time.Now().UnixNano()%1_000_000),
		ProjectID:      "project-dbint",
		OrganizationID: "org-test",
		DatabaseName:   "app",
		Username:       "app",
		Password:       "0123456789abcdef0123456789abcdef",
		StorageLimitMB: MaxDatabaseStorageMB,
	}

	ctx, cancel := context.WithTimeout(context.Background(), databaseDockerDeadline)
	defer cancel()

	// A leftover from an earlier run would make the test pass on stale state.
	_, _ = manager.RemoveDatabase(ctx, request.DatabaseID)
	_ = exec.Command("docker", "network", "rm", projectNetwork(request.ProjectID)).Run()

	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cleanupCancel()
		_, _ = manager.RemoveDatabase(cleanupCtx, request.DatabaseID)
		_ = exec.Command("docker", "network", "rm", projectNetwork(request.ProjectID)).Run()
	})

	state, err := manager.EnsureDatabase(ctx, request)
	if err != nil {
		t.Fatalf("ensure Database: %v", err)
	}
	if state.Status != "running" || !state.Healthy {
		t.Fatalf("expected a healthy running Database, got %+v", state)
	}

	// No host port may be published: the only way in is the Project network.
	ports, err := exec.Command("docker", "port", databaseContainerName(request.DatabaseID)).Output()
	if err != nil {
		t.Fatalf("read published ports: %v", err)
	}
	if strings.TrimSpace(string(ports)) != "" {
		t.Fatalf("expected no published ports, got %q", ports)
	}

	// A container on the Project network reaches the Database through `db`.
	serviceProbe := exec.Command(
		"docker", "run", "--rm",
		"--network", projectNetwork(request.ProjectID),
		"--env", "PGPASSWORD="+request.Password,
		DatabaseImage,
		"psql", "--host", DatabaseAlias, "--username", request.Username,
		"--dbname", request.DatabaseName, "--no-psqlrc", "--command", "SELECT 42 AS ok",
	)
	output, err := serviceProbe.CombinedOutput()
	if err != nil {
		t.Fatalf("expected a Service on the Project network to connect: %v\n%s", err, output)
	}
	if !strings.Contains(string(output), "42") {
		t.Fatalf("expected the query to return 42, got %q", output)
	}

	// The host itself has no route in: a client outside the Project network
	// cannot even resolve the alias.
	hostProbe := exec.Command(
		"docker", "run", "--rm",
		"--env", "PGPASSWORD="+request.Password,
		DatabaseImage,
		"psql", "--host", DatabaseAlias, "--username", request.Username,
		"--dbname", request.DatabaseName, "--no-psqlrc", "--command", "SELECT 1",
	)
	output, err = hostProbe.CombinedOutput()
	if err == nil {
		t.Fatalf("expected a client outside the Project network to fail, got %q", output)
	}
}
