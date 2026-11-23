package runtime

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"testing"
	"time"

	stealthexec "stealth/agent/internal/exec"
)

// TestDockerPublicDatabaseProxyIsRefused proves the shared model publishes no
// public database port at all. One listener would forward to a server that holds
// every tenant, so the request is refused before any container is created.
func TestDockerPublicDatabaseProxyIsRefused(t *testing.T) {
	requireDocker(t)

	docker := NewCLIDocker(stealthexec.SystemExecutor{}, "")
	manager := NewManager(docker, newFakeRouter())

	databaseID := "dbproxy" + fmt.Sprint(time.Now().UnixNano()%1_000_000)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	_, err := manager.EnsureDatabaseProxy(ctx, DatabaseProxyRequest{
		DatabaseID: databaseID,
		ProjectID:  "project-dbproxy",
		Allowlist:  []string{"127.0.0.0/8"},
	})
	if err == nil {
		t.Fatal("expected the public proxy to be refused")
	}
	if !errors.Is(err, ErrDatabaseProxyDisabled) {
		t.Fatalf("expected %v, got %v", ErrDatabaseProxyDisabled, err)
	}

	// Nothing may have been published on the host.
	if output, err := exec.Command(
		"docker", "port", databaseProxyContainerName(databaseID),
	).Output(); err == nil {
		t.Fatalf("expected no listener, got %q", output)
	}
}
