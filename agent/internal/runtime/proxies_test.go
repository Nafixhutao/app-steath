package runtime

import (
	"context"
	"errors"
	"testing"
)

func proxyRequest() DatabaseProxyRequest {
	return DatabaseProxyRequest{
		DatabaseID: "database-1",
		ProjectID:  "project-1",
		Allowlist:  []string{"203.0.113.0/24"},
	}
}

// TestEnsureDatabaseProxyRequiresAnAllowlist keeps the request validation that
// still applies: a malformed allowlist is reported as such.
func TestEnsureDatabaseProxyRequiresAnAllowlist(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	request := proxyRequest()
	request.Allowlist = nil
	if _, err := manager.EnsureDatabaseProxy(context.Background(), request); !errors.Is(
		err,
		ErrInvalidDatabaseProxy,
	) {
		t.Fatalf("expected an empty allowlist to be rejected, got %v", err)
	}

	request.Allowlist = []string{"", "  "}
	if _, err := manager.EnsureDatabaseProxy(context.Background(), request); !errors.Is(
		err,
		ErrInvalidDatabaseProxy,
	) {
		t.Fatalf("expected a blank allowlist to be rejected, got %v", err)
	}
}

func TestEnsureDatabaseProxyRejectsMalformedCIDRs(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	for _, value := range []string{"not-a-cidr", "10.0.0.0/33", "::1/129", "10.0.0.1;drop"} {
		request := proxyRequest()
		request.Allowlist = []string{value}
		if _, err := manager.EnsureDatabaseProxy(context.Background(), request); !errors.Is(
			err,
			ErrInvalidDatabaseProxy,
		) {
			t.Fatalf("expected %q to be rejected, got %v", value, err)
		}
	}
}

// TestEnsureDatabaseProxyIsRefusedForEveryEngine is the core of the shared model:
// one public port would forward to a server holding every tenant, so no listener
// is ever created.
func TestEnsureDatabaseProxyIsRefusedForEveryEngine(t *testing.T) {
	for _, engine := range []string{DatabaseEnginePostgres, DatabaseEngineMySQL} {
		t.Run(engine, func(t *testing.T) {
			docker := newFakeDocker()
			manager := testManager(t, docker, newFakeRouter())

			_, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest())
			if !errors.Is(err, ErrDatabaseProxyDisabled) {
				t.Fatalf("expected %v, got %v", ErrDatabaseProxyDisabled, err)
			}

			// No listener container and no certificate Volume may be created.
			if len(docker.created) != 0 {
				t.Fatalf("expected no container, got %v", docker.created)
			}
			if len(docker.volumes) != 0 {
				t.Fatalf("expected no Volume, got %v", docker.volumes)
			}
		})
	}
}

// TestEnsureDatabaseProxyTearsDownALeftoverListener proves a listener from the
// per-Project model is revoked rather than left open.
func TestEnsureDatabaseProxyTearsDownALeftoverListener(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:  databaseProxyContainerName("database-1"),
		Image: "nginx:1.27-alpine",
		Labels: map[string]string{
			LabelType:       ResourceTypeDatabaseProxy,
			LabelDatabaseID: "database-1",
		},
	}); err != nil {
		t.Fatalf("seed the leftover listener: %v", err)
	}

	if _, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest()); !errors.Is(
		err,
		ErrDatabaseProxyDisabled,
	) {
		t.Fatalf("expected %v, got %v", ErrDatabaseProxyDisabled, err)
	}

	if _, ok := docker.find(databaseProxyContainerName("database-1")); ok {
		t.Fatal("expected the leftover listener to be removed")
	}
}

func TestGetDatabaseProxyReportsDisabledWhenAbsent(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	state, err := manager.GetDatabaseProxy(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if state.Enabled || state.Port != 0 {
		t.Fatalf("expected a disabled endpoint, got %+v", state)
	}
}

func TestRemoveDatabaseProxyRevokesTheListenerAndVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:  databaseProxyContainerName("database-1"),
		Image: "nginx:1.27-alpine",
		Labels: map[string]string{
			LabelType:       ResourceTypeDatabaseProxy,
			LabelDatabaseID: "database-1",
		},
	}); err != nil {
		t.Fatalf("seed the listener: %v", err)
	}
	if err := docker.EnsureVolume(context.Background(), VolumeSpec{
		Name: databaseProxyVolumeName("database-1"),
	}); err != nil {
		t.Fatalf("seed the Volume: %v", err)
	}

	removed, err := manager.RemoveDatabaseProxy(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if !removed {
		t.Fatal("expected the proxy to be reported as removed")
	}
	if _, ok := docker.find(databaseProxyContainerName("database-1")); ok {
		t.Fatal("expected the listener to be gone")
	}
	if _, ok := docker.volumes[databaseProxyVolumeName("database-1")]; ok {
		t.Fatal("expected the certificate Volume to be gone")
	}

	// A second removal is a no-op, so disabling is safe to retry.
	if _, err := manager.RemoveDatabaseProxy(context.Background(), "database-1"); err != nil {
		t.Fatalf("second remove: %v", err)
	}
}

// TestRemoveDatabaseRevokesALeftoverProxy proves a Database deleted after the
// switch to shared servers still has its old listener revoked.
func TestRemoveDatabaseRevokesTheProxy(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:  databaseProxyContainerName("database-1"),
		Image: "nginx:1.27-alpine",
		Labels: map[string]string{
			LabelType:       ResourceTypeDatabaseProxy,
			LabelDatabaseID: "database-1",
		},
	}); err != nil {
		t.Fatalf("seed the listener: %v", err)
	}

	if _, err := manager.RemoveDatabase(context.Background(), "database-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}

	if _, ok := docker.find(databaseProxyContainerName("database-1")); ok {
		t.Fatal("expected the leftover listener to be revoked with the Database")
	}
}
