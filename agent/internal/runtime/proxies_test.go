package runtime

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
)

func proxyRequest() DatabaseProxyRequest {
	return DatabaseProxyRequest{
		DatabaseID: "database-1",
		ProjectID:  "project-1",
		Allowlist:  []string{"203.0.113.0/24"},
	}
}

func ensureProxyDatabase(t *testing.T, manager *Manager) {
	t.Helper()

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure Database: %v", err)
	}
}

func TestEnsureDatabaseProxyRequiresAnAllowlist(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())
	ensureProxyDatabase(t, manager)

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
		t.Fatalf("expected blank allowlist entries to be rejected, got %v", err)
	}
}

func TestEnsureDatabaseProxyRejectsMalformedCIDRs(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())
	ensureProxyDatabase(t, manager)

	for _, value := range []string{
		"not-an-ip",
		"10.0.0.0/33",
		"10.0.0.0/24; allow all",
		"10.0.0.1\nallow all",
	} {
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

func TestEnsureDatabaseProxyPublishesATLSListenerOnAUniquePort(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	ensureProxyDatabase(t, manager)

	state, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest())
	if err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}
	if !state.Enabled {
		t.Fatal("expected the proxy to be enabled")
	}
	if state.Port < DatabaseProxyPortMin || state.Port > DatabaseProxyPortMax {
		t.Fatalf("expected a port in the public range, got %d", state.Port)
	}
	if len(state.Allowlist) != 1 || state.Allowlist[0] != "203.0.113.0/24" {
		t.Fatalf("unexpected allowlist: %v", state.Allowlist)
	}

	// The Database itself was created first, so the proxy is the second
	// container. It must publish the allocated port and run unprivileged nginx.
	var spec ContainerSpec
	for _, created := range docker.created {
		if created.Labels[LabelType] == ResourceTypeDatabaseProxy {
			spec = created
		}
	}
	if spec.Name == "" {
		t.Fatal("expected a proxy container")
	}
	if spec.Image != DatabaseProxyImage {
		t.Fatalf("expected %s, got %s", DatabaseProxyImage, spec.Image)
	}
	if spec.PublishedPort != state.Port {
		t.Fatalf("expected the container to publish %d, got %d", state.Port, spec.PublishedPort)
	}
	if spec.Port != DatabaseProxyInternalPort {
		t.Fatalf("expected the internal port %d, got %d", DatabaseProxyInternalPort, spec.Port)
	}
	if spec.Entrypoint != "nginx" {
		t.Fatalf("expected the nginx entrypoint, got %q", spec.Entrypoint)
	}
	if !spec.ReadOnlyRoot {
		t.Fatal("expected the proxy root filesystem to be read-only")
	}
	if spec.User != DatabaseProxyUser {
		t.Fatalf("expected the proxy to run as %q, got %q", DatabaseProxyUser, spec.User)
	}
	if spec.Volume == nil || spec.Volume.Name != databaseProxyVolumeName("database-1") {
		t.Fatalf("expected the proxy certificate Volume, got %+v", spec.Volume)
	}
	if spec.Labels[LabelDatabaseID] != "database-1" {
		t.Fatalf("expected the Database label, got %q", spec.Labels[LabelDatabaseID])
	}
	if spec.Labels[LabelDatabaseProxyPort] != strconv.Itoa(state.Port) {
		t.Fatalf("expected the port label, got %q", spec.Labels[LabelDatabaseProxyPort])
	}

	files := docker.volumeFiles[databaseProxyVolumeName("database-1")]
	if files == nil {
		t.Fatal("expected the proxy Volume files to be written")
	}
	if !strings.Contains(files["nginx.conf"], "listen 5432;") {
		t.Fatalf("expected the listener in the config, got %q", files["nginx.conf"])
	}
	if strings.Contains(files["nginx.conf"], "ssl") {
		t.Fatalf("expected PostgreSQL, not nginx, to terminate TLS, got %q", files["nginx.conf"])
	}
	if !strings.Contains(files["nginx.conf"], "allow 203.0.113.0/24;") {
		t.Fatalf("expected the allowlist in the config, got %q", files["nginx.conf"])
	}
	if !strings.Contains(files["nginx.conf"], "deny all;") {
		t.Fatalf("expected the config to fail closed, got %q", files["nginx.conf"])
	}
}

func TestEnsureDatabaseProxyNormalizesBareAddresses(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())
	ensureProxyDatabase(t, manager)

	request := proxyRequest()
	request.Allowlist = []string{"198.51.100.7", "2001:db8::1", "203.0.113.0/24", "203.0.113.0/24"}
	state, err := manager.EnsureDatabaseProxy(context.Background(), request)
	if err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}

	want := []string{"198.51.100.7/32", "2001:db8::1/128", "203.0.113.0/24"}
	if len(state.Allowlist) != len(want) {
		t.Fatalf("expected %d deduplicated entries, got %v", len(want), state.Allowlist)
	}
	for index, value := range want {
		if state.Allowlist[index] != value {
			t.Fatalf("expected %q at %d, got %q", value, index, state.Allowlist[index])
		}
	}
}

func TestEnsureDatabaseProxyRejectsTooManyEntries(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())
	ensureProxyDatabase(t, manager)

	request := proxyRequest()
	request.Allowlist = make([]string, 0, MaxDatabaseProxyAllowlist+1)
	for index := 0; index <= MaxDatabaseProxyAllowlist; index++ {
		request.Allowlist = append(request.Allowlist, "10.0."+strconv.Itoa(index/256)+"."+strconv.Itoa(index%256)+"/32")
	}

	if _, err := manager.EnsureDatabaseProxy(context.Background(), request); !errors.Is(
		err,
		ErrInvalidDatabaseProxy,
	) {
		t.Fatalf("expected an oversized allowlist to be rejected, got %v", err)
	}
}

func TestEnsureDatabaseProxyReusesThePortOnUpdate(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	ensureProxyDatabase(t, manager)

	first, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest())
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}

	update := proxyRequest()
	update.Allowlist = []string{"198.51.100.0/24"}
	second, err := manager.EnsureDatabaseProxy(context.Background(), update)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if second.Port != first.Port {
		t.Fatalf("expected the port to be reused (%d), got %d", first.Port, second.Port)
	}

	files := docker.volumeFiles[databaseProxyVolumeName("database-1")]
	if !strings.Contains(files["nginx.conf"], "allow 198.51.100.0/24;") {
		t.Fatalf("expected the updated allowlist in the config, got %q", files["nginx.conf"])
	}
	if strings.Contains(files["nginx.conf"], "203.0.113.0/24") {
		t.Fatalf("expected the old allowlist to be gone, got %q", files["nginx.conf"])
	}
}

func TestEnsureDatabaseProxyAvoidsAnOccupiedPort(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	ensureProxyDatabase(t, manager)

	occupied := proxyStartPort("database-1")
	docker.containers["occupied"] = &fakeContainer{
		ID:             "occupied",
		Name:           "someone-else",
		State:          "running",
		Labels:         map[string]string{LabelType: "other"},
		Networks:       map[string]string{},
		PublishedPorts: []int{occupied},
	}

	state, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest())
	if err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}
	if state.Port == occupied {
		t.Fatalf("expected the allocator to skip the occupied port %d", occupied)
	}
	if state.Port < DatabaseProxyPortMin || state.Port > DatabaseProxyPortMax {
		t.Fatalf("expected a port in the public range, got %d", state.Port)
	}
}

func TestEnsureDatabaseProxyNeedsARunningDatabase(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	if _, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest()); !errors.Is(
		err,
		ErrUnknownDatabase,
	) {
		t.Fatalf("expected a missing Database to be rejected, got %v", err)
	}
}

func TestEnsureDatabaseProxyRejectsAnotherProjectsDatabase(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())
	ensureProxyDatabase(t, manager)

	request := proxyRequest()
	request.ProjectID = "project-2"
	if _, err := manager.EnsureDatabaseProxy(context.Background(), request); !errors.Is(
		err,
		ErrInvalidDatabaseProxy,
	) {
		t.Fatalf("expected a cross-Project request to be rejected, got %v", err)
	}
}

func TestGetDatabaseProxyReportsDisabledWhenAbsent(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	state, err := manager.GetDatabaseProxy(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if state.Enabled {
		t.Fatal("expected the proxy to be disabled")
	}
	if state.Port != 0 {
		t.Fatalf("expected no port, got %d", state.Port)
	}
}

func TestRemoveDatabaseProxyRevokesTheListenerAndVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	ensureProxyDatabase(t, manager)

	state, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest())
	if err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}

	removed, err := manager.RemoveDatabaseProxy(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("remove proxy: %v", err)
	}
	if !removed {
		t.Fatal("expected the proxy to be reported as removed")
	}
	if _, ok := docker.find(databaseProxyContainerName("database-1")); ok {
		t.Fatal("expected the listener container to be gone")
	}
	if _, ok := docker.volumes[databaseProxyVolumeName("database-1")]; ok {
		t.Fatal("expected the certificate Volume to be gone")
	}

	after, err := manager.GetDatabaseProxy(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("get after remove: %v", err)
	}
	if after.Enabled || after.Port != 0 {
		t.Fatalf("expected the endpoint to be revoked, got %+v", after)
	}
	if after.Port == state.Port && state.Port != 0 {
		t.Fatalf("expected the old port %d to be gone", state.Port)
	}

	// Disabling again must not fail.
	if again, err := manager.RemoveDatabaseProxy(context.Background(), "database-1"); err != nil || again {
		t.Fatalf("expected an idempotent disable, got removed=%t err=%v", again, err)
	}
}

func TestRemoveDatabaseRevokesTheProxy(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	ensureProxyDatabase(t, manager)

	if _, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest()); err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}

	if _, err := manager.RemoveDatabase(context.Background(), "database-1"); err != nil {
		t.Fatalf("remove Database: %v", err)
	}
	if _, ok := docker.find(databaseProxyContainerName("database-1")); ok {
		t.Fatal("expected the proxy to be removed with the Database")
	}
	if _, ok := docker.volumes[databaseProxyVolumeName("database-1")]; ok {
		t.Fatal("expected the proxy Volume to be removed with the Database")
	}
}

func TestCleanupKeepsALiveProxyAndRemovesAnOrphan(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetCleanupStatePath(t.TempDir() + "/cleanup.json")

	ensureProxyDatabase(t, manager)
	if _, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest()); err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}

	docker.containers["orphan"] = &fakeContainer{
		ID:       "orphan",
		Name:     databaseProxyContainerName("gone"),
		State:    "running",
		Labels:   map[string]string{LabelType: ResourceTypeDatabaseProxy, LabelDatabaseID: "gone", LabelProjectID: "project-1"},
		Networks: map[string]string{},
	}
	docker.volumes[databaseProxyVolumeName("gone")] = &fakeVolume{
		Name:   databaseProxyVolumeName("gone"),
		Labels: map[string]string{LabelType: ResourceTypeDatabaseProxy, LabelDatabaseID: "gone"},
	}

	if _, err := manager.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if _, ok := docker.find(databaseProxyContainerName("database-1")); !ok {
		t.Fatal("expected the live proxy to survive cleanup")
	}
	if _, ok := docker.volumes[databaseProxyVolumeName("database-1")]; !ok {
		t.Fatal("expected the live proxy Volume to survive cleanup")
	}
	if _, ok := docker.find("orphan"); ok {
		t.Fatal("expected the orphan proxy to be removed")
	}
	if _, ok := docker.volumes[databaseProxyVolumeName("gone")]; ok {
		t.Fatal("expected the orphan proxy Volume to be removed")
	}
}

func TestReconcileReattachesAProxyToItsProjectNetwork(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	ensureProxyDatabase(t, manager)
	if _, err := manager.EnsureDatabaseProxy(context.Background(), proxyRequest()); err != nil {
		t.Fatalf("ensure proxy: %v", err)
	}

	// Simulate a restart where the Project network was recreated and the proxy
	// lost its membership.
	delete(docker.networks, projectNetwork("project-1"))
	proxy, _ := docker.find(databaseProxyContainerName("database-1"))
	delete(proxy.Networks, projectNetwork("project-1"))

	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if _, ok := proxy.Networks[projectNetwork("project-1")]; !ok {
		t.Fatal("expected reconcile to reattach the proxy to its Project network")
	}
}
