package runtime

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	stealthexec "stealth/agent/internal/exec"
)

// proxyDockerDeadline is longer than dockerDeadline because the first run may
// pull the nginx image and the test starts several short-lived psql clients.
const proxyDockerDeadline = 6 * time.Minute

// TestDockerDatabaseProxyEnforcesTLSAndTheAllowlist proves the public endpoint
// promises: it is reachable from outside only over TLS, only from an allowed
// source, and disabling it revokes the port.
func TestDockerDatabaseProxyEnforcesTLSAndTheAllowlist(t *testing.T) {
	requireDocker(t)

	docker := NewCLIDocker(stealthexec.SystemExecutor{}, "")
	manager := NewManager(docker, newFakeRouter())

	request := DatabaseRequest{
		DatabaseID:     "dbproxy" + fmt.Sprint(time.Now().UnixNano()%1_000_000),
		ProjectID:      "project-dbproxy",
		OrganizationID: "org-test",
		DatabaseName:   "app",
		Username:       "app",
		Password:       "0123456789abcdef0123456789abcdef",
		StorageLimitMB: MaxDatabaseStorageMB,
	}
	// The test client is a host-network container, so its source address is the
	// Docker gateway. These ranges cover the default bridge networks on Linux and
	// Docker Desktop; the deny case below uses a range that cannot match.
	proxy := DatabaseProxyRequest{
		DatabaseID: request.DatabaseID,
		ProjectID:  request.ProjectID,
		Allowlist:  []string{"127.0.0.0/8", "10.0.0.0/8", "172.0.0.0/8", "192.168.0.0/16"},
	}

	ctx, cancel := context.WithTimeout(context.Background(), proxyDockerDeadline)
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

	if _, err := manager.EnsureDatabase(ctx, request); err != nil {
		t.Fatalf("ensure Database: %v", err)
	}

	state, err := manager.EnsureDatabaseProxy(ctx, proxy)
	if err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}
	if !state.Enabled {
		t.Fatal("expected the proxy to be enabled")
	}
	if state.Port < DatabaseProxyPortMin || state.Port > DatabaseProxyPortMax {
		t.Fatalf("expected a public port, got %d", state.Port)
	}

	ports, err := exec.Command("docker", "port", databaseProxyContainerName(request.DatabaseID)).Output()
	if err != nil {
		t.Fatalf("read published ports: %v", err)
	}
	if !strings.Contains(string(ports), strconv.Itoa(state.Port)) {
		t.Fatalf("expected the proxy to publish %d, got %q", state.Port, ports)
	}

	// `sslmode=require` proves the public endpoint really speaks TLS; the proxy
	// forwards the stream and PostgreSQL terminates it.
	output, err := proxyQuery(ctx, request, state.Port, "require", "SELECT 'tls-ok' AS result")
	if err != nil {
		t.Fatalf("expected a TLS connection through the proxy: %v\n%s", err, output)
	}
	if !strings.Contains(output, "tls-ok") {
		t.Fatalf("expected the query to succeed, got %q", output)
	}

	// The Database's pg_hba.conf accepts only `hostssl`, so a plaintext client
	// must be rejected even though the proxy forwards the bytes.
	if output, err := proxyQuery(ctx, request, state.Port, "disable", "SELECT 1"); err == nil {
		t.Fatalf("expected a plaintext connection to fail, got %q", output)
	}

	// Replacing the allowlist with a CIDR that cannot match the client must
	// reject it immediately, without changing the public port.
	update := proxy
	update.Allowlist = []string{"203.0.113.0/24"}
	updated, err := manager.EnsureDatabaseProxy(ctx, update)
	if err != nil {
		t.Fatalf("update proxy: %v", err)
	}
	if updated.Port != state.Port {
		t.Fatalf("expected the port %d to be reused, got %d", state.Port, updated.Port)
	}
	if output, err := proxyQuery(ctx, request, updated.Port, "require", "SELECT 1"); err == nil {
		t.Fatalf("expected a client outside the allowlist to be rejected, got %q", output)
	}

	// Disabling must stop the listener and revoke the endpoint.
	removed, err := manager.RemoveDatabaseProxy(ctx, request.DatabaseID)
	if err != nil {
		t.Fatalf("remove proxy: %v", err)
	}
	if !removed {
		t.Fatal("expected the proxy to be reported as removed")
	}
	if output, err := exec.Command(
		"docker", "port", databaseProxyContainerName(request.DatabaseID),
	).Output(); err == nil {
		t.Fatalf("expected the listener to be gone, got %q", output)
	}

	after, err := manager.GetDatabaseProxy(ctx, request.DatabaseID)
	if err != nil {
		t.Fatalf("get after remove: %v", err)
	}
	if after.Enabled || after.Port != 0 {
		t.Fatalf("expected the endpoint to be revoked, got %+v", after)
	}
}

// proxyQuery runs psql from a host-network container so the request reaches the
// published port from outside the Project network.
func proxyQuery(
	ctx context.Context,
	request DatabaseRequest,
	port int,
	sslmode string,
	query string,
) (string, error) {
	command := exec.CommandContext(
		ctx,
		"docker", "run", "--rm",
		"--network", "host",
		"--env", "PGPASSWORD="+request.Password,
		"--env", "PGSSLMODE="+sslmode,
		DatabaseImage,
		"psql",
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
		"--username", request.Username,
		"--dbname", request.DatabaseName,
		"--no-psqlrc",
		"--command", query,
	)

	output, err := command.CombinedOutput()

	return string(output), err
}
