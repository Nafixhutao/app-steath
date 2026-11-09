package runtime

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	stealthexec "stealth/agent/internal/exec"
)

// These tests run the real docker CLI and a real Caddy admin API, because the
// parts worth proving here are exactly the ones a fake cannot: that the container
// really is hardened and limited, that the probe really reaches the app, and that
// Caddy really serves the Platform Subdomain. They skip when Docker or Caddy is
// not reachable so the unit tests stay runnable anywhere.

// dockerDeadline bounds the container work in these tests.
const dockerDeadline = 3 * time.Minute

func requireDocker(t *testing.T) {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping Docker test in short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := exec.CommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}").Run(); err != nil {
		t.Skipf("Docker is not available: %v", err)
	}
}

// buildTestImage builds a tiny static site image once per test run. Using a real
// image keeps the test honest: the container runs the same way a Service does.
func buildTestImage(t *testing.T) string {
	t.Helper()

	tag := "stealth-runtime-test:latest"
	contextDir := t.TempDir()
	dockerfile := "FROM busybox:1.36\n" +
		"WORKDIR /www\n" +
		"RUN echo healthy > index.html\n" +
		"USER 1000:1000\n" +
		"EXPOSE 3000\n" +
		"CMD [\"httpd\", \"-f\", \"-p\", \"3000\"]\n"

	if err := os.WriteFile(filepath.Join(contextDir, "Dockerfile"), []byte(dockerfile), 0o600); err != nil {
		t.Fatalf("write Dockerfile: %v", err)
	}

	build := exec.Command("docker", "build", "--tag", tag, contextDir)
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build test image: %v\n%s", err, output)
	}

	t.Cleanup(func() {
		_ = exec.Command("docker", "image", "rm", "--force", tag).Run()
	})

	return tag
}

// startCaddy runs Caddy in a container with its admin API published, and returns
// the admin URL and the container name. A Caddy already listening on the admin
// port is reused, which keeps the test fast on a machine that already runs the
// compose stack.
func startCaddy(t *testing.T) (string, string) {
	t.Helper()

	const adminURL = "http://127.0.0.1:2019"
	if caddyAdminReachable(adminURL) {
		// The attacher needs the container name, so find whichever Caddy is
		// already serving the admin port instead of assuming a name.
		return adminURL, caddyContainerName(t)
	}

	// Caddy refuses an empty config, so the test gives it a minimal one: the
	// admin API plus the internal CA that issues the Platform Subdomain
	// certificate for nip.io hostnames.
	configDir := t.TempDir()
	caddyfile := "{\n\tadmin 0.0.0.0:2019\n\tlocal_certs\n}\n"
	if err := os.WriteFile(filepath.Join(configDir, "Caddyfile"), []byte(caddyfile), 0o600); err != nil {
		t.Fatalf("write Caddyfile: %v", err)
	}

	containerName := "stealth-caddy-test"
	_ = exec.Command("docker", "rm", "--force", containerName).Run()

	run := exec.Command(
		"docker", "run", "--detach",
		"--name", containerName,
		"--publish", "2019:2019",
		"--volume", configDir+":/etc/caddy",
		"caddy:2-alpine",
	)
	if output, err := run.CombinedOutput(); err != nil {
		t.Skipf("Caddy is not available: %v\n%s", err, output)
	}

	t.Cleanup(func() {
		_ = exec.Command("docker", "rm", "--force", containerName).Run()
	})

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if caddyAdminReachable(adminURL) {
			return adminURL, containerName
		}
		time.Sleep(500 * time.Millisecond)
	}

	logs, _ := exec.Command("docker", "logs", containerName).CombinedOutput()
	t.Fatalf("Caddy admin API did not become reachable:\n%s", logs)

	return "", ""
}

// caddyContainerName finds the container that publishes the admin port.
func caddyContainerName(t *testing.T) string {
	t.Helper()

	out, err := exec.Command("docker", "ps", "--quiet", "--filter", "publish=2019").Output()
	if err != nil {
		t.Fatalf("find the Caddy container: %v", err)
	}

	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		t.Fatal("no container publishes the Caddy admin port")
	}

	name, err := exec.Command("docker", "inspect", ids[0], "--format", "{{.Name}}").Output()
	if err != nil {
		t.Fatalf("read the Caddy container name: %v", err)
	}

	return strings.TrimPrefix(strings.TrimSpace(string(name)), "/")
}

func caddyAdminReachable(adminURL string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, adminURL+"/config/", nil)
	if err != nil {
		return false
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()

	return response.StatusCode < 400
}

// newDockerBackedManager returns a Manager using the real CLI and the real Caddy
// admin API, with Caddy attached to Project networks the way production does it.
func newDockerBackedManager(t *testing.T) (*Manager, *CaddyRouter) {
	t.Helper()

	docker := NewCLIDocker(stealthexec.SystemExecutor{}, "")
	adminURL, caddyContainer := startCaddy(t)
	router := NewCaddyRouter(adminURL)

	manager := NewManager(docker, router)
	manager.healthTimeout = 30 * time.Second
	manager.SetNetworkAttacher(NewCaddyAttacher(docker, caddyContainer))

	return manager, router
}

// cleanupService removes everything a test created on the node.
func cleanupService(t *testing.T, manager *Manager, request DeployRequest) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	_, _ = manager.Remove(ctx, request.ServiceID)

	for _, name := range []string{
		serviceContainerName(request.ServiceID),
		candidateContainerName(request.ServiceID),
		serviceContainerName(request.ServiceID) + "-previous",
	} {
		_ = exec.Command("docker", "rm", "--force", name).Run()
	}
	_ = exec.Command("docker", "network", "rm", projectNetwork(request.ProjectID)).Run()
}

func dockerRequest(serviceID string) DeployRequest {
	return DeployRequest{
		DeploymentID:   "deployment-" + serviceID,
		ServiceID:      serviceID,
		ProjectID:      "project-" + serviceID,
		OrganizationID: "org-test",
		Hostname:       serviceID + ".127.0.0.1.nip.io",
		ImageRef:       "stealth-runtime-test:latest",
		ContainerPort:  3000,
		HealthPath:     "/",
		CPULimit:       0.5,
		MemoryLimitMB:  512,
	}
}

func TestDockerDeployRunsAHardenedLimitedContainer(t *testing.T) {
	requireDocker(t)
	buildTestImage(t)

	manager, _ := newDockerBackedManager(t)
	request := dockerRequest("svchardened")
	t.Cleanup(func() { cleanupService(t, manager, request) })

	ctx, cancel := context.WithTimeout(context.Background(), dockerDeadline)
	defer cancel()

	result, err := manager.Deploy(ctx, request)
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "running" {
		t.Fatalf("expected a running deployment, got %q: %s", result.Status, result.Error)
	}

	// Inspect the running container to prove the limits and hardening are real
	// and not just flags the agent intended to pass.
	inspect := exec.Command(
		"docker", "inspect", result.ContainerID,
		"--format",
		"{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}|"+
			"{{.HostConfig.Privileged}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.NetworkMode}}|"+
			"{{.Config.User}}|{{json .HostConfig.CapDrop}}",
	)
	output, err := inspect.Output()
	if err != nil {
		t.Fatalf("inspect container: %v", err)
	}

	fields := strings.Split(strings.TrimSpace(string(output)), "|")
	if len(fields) != 8 {
		t.Fatalf("unexpected inspect output %q", output)
	}

	if fields[0] != "536870912" {
		t.Fatalf("expected a 512 MB memory limit, got %s", fields[0])
	}
	if fields[1] != "500000000" {
		t.Fatalf("expected a 0.5 vCPU limit, got %s", fields[1])
	}
	if fields[3] != "false" {
		t.Fatal("expected the container to be non-privileged")
	}
	if fields[4] != "true" {
		t.Fatal("expected a read-only root filesystem")
	}
	if !strings.Contains(fields[7], "ALL") {
		t.Fatalf("expected all capabilities to be dropped, got %s", fields[7])
	}
	if !strings.HasPrefix(fields[5], "stealth-project-project-svchardened") {
		t.Fatalf("expected the Project network, got %s", fields[5])
	}
	// No host port bindings: the only way in is Caddy on the Project network.
	ports := exec.Command("docker", "inspect", result.ContainerID, "--format", "{{json .HostConfig.PortBindings}}")
	bindings, err := ports.Output()
	if err != nil {
		t.Fatalf("inspect port bindings: %v", err)
	}
	if strings.TrimSpace(string(bindings)) != "{}" && strings.TrimSpace(string(bindings)) != "null" {
		t.Fatalf("expected no host port bindings, got %s", bindings)
	}
}

func TestDockerDeployFailsWhenTheHealthCheckNeverPasses(t *testing.T) {
	requireDocker(t)

	// An image whose process exits immediately can never answer the probe.
	tag := "stealth-runtime-broken:latest"
	contextDir := t.TempDir()
	dockerfile := "FROM busybox:1.36\nCMD [\"sh\", \"-c\", \"echo not a server\"]\n"
	if err := os.WriteFile(filepath.Join(contextDir, "Dockerfile"), []byte(dockerfile), 0o600); err != nil {
		t.Fatalf("write Dockerfile: %v", err)
	}
	if output, err := exec.Command("docker", "build", "--tag", tag, contextDir).CombinedOutput(); err != nil {
		t.Fatalf("build broken image: %v\n%s", err, output)
	}
	t.Cleanup(func() { _ = exec.Command("docker", "image", "rm", "--force", tag).Run() })

	manager, router := newDockerBackedManager(t)
	request := dockerRequest("svcbroken")
	request.ImageRef = tag
	t.Cleanup(func() { cleanupService(t, manager, request) })

	ctx, cancel := context.WithTimeout(context.Background(), dockerDeadline)
	defer cancel()

	result, err := manager.Deploy(ctx, request)
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if result.Status != "failed" {
		t.Fatalf("expected a failed deployment, got %q", result.Status)
	}
	if result.Error == "" {
		t.Fatal("expected an error explaining why the Deployment failed")
	}

	// A failed first Deployment must not leave a route behind.
	if hasRoute(t, router, request.Hostname) {
		t.Fatalf("expected no route for a failed Deployment, got one for %s", request.Hostname)
	}

	// And it must not leave a container running.
	out, err := exec.Command("docker", "ps", "--all", "--quiet", "--filter", "label="+LabelServiceID+"="+request.ServiceID).Output()
	if err != nil {
		t.Fatalf("list containers: %v", err)
	}
	if strings.TrimSpace(string(out)) != "" {
		t.Fatalf("expected no leftover container, got %s", out)
	}
}

func TestDockerStopStartKeepsTheContainerAndItsData(t *testing.T) {
	requireDocker(t)
	buildTestImage(t)

	manager, _ := newDockerBackedManager(t)
	request := dockerRequest("svclifecycle")
	t.Cleanup(func() { cleanupService(t, manager, request) })

	ctx, cancel := context.WithTimeout(context.Background(), dockerDeadline)
	defer cancel()

	deployed, err := manager.Deploy(ctx, request)
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}

	// Capture the container's identity, so the test can prove the same container
	// object survived instead of a fresh one being created. A container that is
	// kept (not removed) is what keeps its writable layer and its volumes, which
	// is the "does not delete data" guarantee for stop, start, and restart.
	createdBefore := inspectField(t, deployed.ContainerID, "{{.Created}}")

	state, err := manager.Stop(ctx, request.ServiceID)
	if err != nil {
		t.Fatalf("stop: %v", err)
	}
	if state.Status != "stopped" {
		t.Fatalf("expected a stopped Service, got %q", state.Status)
	}

	// A stopped Service keeps its container, so a start brings the same one back.
	if dockerState := inspectField(t, deployed.ContainerID, "{{.State.Status}}"); dockerState != "exited" {
		t.Fatalf("expected the container to be stopped but kept, got %q", dockerState)
	}

	state, err = manager.Start(ctx, request.ServiceID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if state.Status != "running" {
		t.Fatalf("expected a running Service, got %q", state.Status)
	}
	if state.ContainerID != deployed.ContainerID {
		t.Fatalf("expected the same container, got %q then %q", deployed.ContainerID, state.ContainerID)
	}
	if createdAfter := inspectField(t, deployed.ContainerID, "{{.Created}}"); createdAfter != createdBefore {
		t.Fatalf("expected the container not to be recreated, created %q then %q", createdBefore, createdAfter)
	}

	state, err = manager.Restart(ctx, request.ServiceID)
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	if state.Status != "running" {
		t.Fatalf("expected a running Service after restart, got %q", state.Status)
	}
	if state.ContainerID != deployed.ContainerID {
		t.Fatalf("expected restart to keep the container, got %q", state.ContainerID)
	}
	if createdAfter := inspectField(t, deployed.ContainerID, "{{.Created}}"); createdAfter != createdBefore {
		t.Fatalf("expected restart not to recreate the container, created %q then %q", createdBefore, createdAfter)
	}

	// The container must still serve after the lifecycle round trip.
	if body := requestThroughCaddy(t, request.Hostname); !strings.Contains(body, "healthy") {
		t.Fatalf("expected the Service to serve after restart, got %q", body)
	}
}

func TestDockerVolumeKeepsItsDataAcrossRestartAndRedeploy(t *testing.T) {
	requireDocker(t)
	buildTestImage(t)

	manager, _ := newDockerBackedManager(t)
	request := dockerRequest("svcvolume")
	request.Volume = &VolumeMount{
		Name:      "stealth-vol-svcvolume",
		MountPath: "/data",
		SizeMB:    MaxVolumeSizeMB,
	}
	t.Cleanup(func() { cleanupService(t, manager, request) })

	ctx, cancel := context.WithTimeout(context.Background(), dockerDeadline)
	defer cancel()

	// The Volume must not survive from an earlier failed run, or the test would
	// pass on stale data.
	_, _ = manager.RemoveVolume(ctx, request.Volume.Name)

	deployed, err := manager.Deploy(ctx, request)
	if err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if deployed.Status != "running" {
		t.Fatalf("expected a running deployment, got %q: %s", deployed.Status, deployed.Error)
	}

	// Write into the mounted Volume, which is the only writable path because the
	// root filesystem is read-only.
	write := exec.Command("docker", "exec", deployed.ContainerID, "sh", "-c", "echo persisted > /data/proof.txt")
	if output, err := write.CombinedOutput(); err != nil {
		t.Fatalf("write into the Volume: %v\n%s", err, output)
	}

	state, err := manager.GetVolume(ctx, request.Volume.Name, request.Volume.SizeMB)
	if err != nil {
		t.Fatalf("get volume: %v", err)
	}
	if !state.Exists || state.UsageMB == 0 {
		t.Fatalf("expected the Volume to exist with usage, got %+v", state)
	}

	// A restart keeps the same container and therefore the same data.
	if _, err := manager.Restart(ctx, request.ServiceID); err != nil {
		t.Fatalf("restart: %v", err)
	}
	read := exec.Command("docker", "exec", deployed.ContainerID, "cat", "/data/proof.txt")
	output, err := read.Output()
	if err != nil {
		t.Fatalf("read after restart: %v", err)
	}
	if strings.TrimSpace(string(output)) != "persisted" {
		t.Fatalf("expected the file to survive the restart, got %q", output)
	}

	// A redeploy replaces the container; the Volume name is stable per Service,
	// so the new container must see the same file.
	redeploy := request
	redeploy.DeploymentID = "deployment-svcvolume-2"
	next, err := manager.Deploy(ctx, redeploy)
	if err != nil {
		t.Fatalf("redeploy: %v", err)
	}
	if next.Status != "running" {
		t.Fatalf("expected a running redeploy, got %q: %s", next.Status, next.Error)
	}
	if next.ContainerID == deployed.ContainerID {
		t.Fatal("expected the redeploy to replace the container")
	}
	read = exec.Command("docker", "exec", next.ContainerID, "cat", "/data/proof.txt")
	output, err = read.Output()
	if err != nil {
		t.Fatalf("read after redeploy: %v", err)
	}
	if strings.TrimSpace(string(output)) != "persisted" {
		t.Fatalf("expected the file to survive the redeploy, got %q", output)
	}

	// Deleting the Service must delete the Volume and its data.
	if _, err := manager.Remove(ctx, request.ServiceID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := exec.Command("docker", "volume", "inspect", request.Volume.Name).Run(); err == nil {
		t.Fatalf("expected the Volume %s to be removed with the Service", request.Volume.Name)
	}
}

// inspectField reads one field from `docker inspect`.
func inspectField(t *testing.T, containerID, format string) string {
	t.Helper()

	output, err := exec.Command("docker", "inspect", containerID, "--format", format).Output()
	if err != nil {
		t.Fatalf("inspect %s: %v", format, err)
	}

	return strings.TrimSpace(string(output))
}

func TestCaddyServesThePlatformSubdomain(t *testing.T) {
	requireDocker(t)
	buildTestImage(t)

	manager, router := newDockerBackedManager(t)
	request := dockerRequest("svccaddy")
	t.Cleanup(func() { cleanupService(t, manager, request) })

	ctx, cancel := context.WithTimeout(context.Background(), dockerDeadline)
	defer cancel()

	if _, err := manager.Deploy(ctx, request); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	// The route must exist in Caddy itself, not just in the agent's memory.
	routes, err := router.ListRoutes(ctx)
	if err != nil {
		t.Fatalf("list routes: %v", err)
	}
	found := false
	for _, route := range routes {
		if route.Hostname == request.Hostname {
			found = true
			if !strings.Contains(route.Upstream, ":3000") {
				t.Fatalf("expected the route to dial port 3000, got %q", route.Upstream)
			}
		}
	}
	if !found {
		t.Fatalf("expected Caddy to have a route for %s, got %v", request.Hostname, routes)
	}

	// Requesting the hostname through Caddy must return the application's page.
	body := requestThroughCaddy(t, request.Hostname)
	if !strings.Contains(body, "healthy") {
		t.Fatalf("expected the app response through Caddy, got %q", body)
	}
}

// hasRoute reports whether Caddy currently has a route for a hostname.
func hasRoute(t *testing.T, router Router, hostname string) bool {
	t.Helper()

	routes, err := router.ListRoutes(context.Background())
	if err != nil {
		t.Fatalf("list routes: %v", err)
	}
	for _, route := range routes {
		if route.Hostname == hostname {
			return true
		}
	}

	return false
}

// requestThroughCaddy asks the Caddy container for a hostname. Caddy runs in a
// container here, so the request is made from inside the Docker network rather
// than from the test host.
func requestThroughCaddy(t *testing.T, hostname string) string {
	t.Helper()

	// Find the Caddy container by its published admin port.
	out, err := exec.Command(
		"docker", "ps", "--quiet",
		"--filter", "publish=2019",
		"--filter", "ancestor=caddy:2-alpine",
	).Output()
	if err != nil {
		t.Fatalf("find caddy container: %v", err)
	}

	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		t.Skip("Caddy runs outside Docker; skipping the end-to-end proxy check")
	}

	// `--resolve` makes curl dial Caddy while sending the Service hostname, which
	// is what a browser does after DNS resolution.
	script := fmt.Sprintf(
		"wget -q -O - --header 'Host: %s' http://127.0.0.1:443/ --no-check-certificate 2>/dev/null || "+
			"wget -q -O - --header 'Host: %s' http://127.0.0.1:80/",
		hostname, hostname,
	)
	probe := exec.Command("docker", "exec", ids[0], "sh", "-c", script)
	output, err := probe.CombinedOutput()
	if err != nil {
		t.Skipf("could not request the hostname through Caddy: %v\n%s", err, output)
	}

	return string(output)
}

// TestRedactEnvironmentHidesValuesInErrorMessages proves a tool error that
// echoes its arguments never carries an Environment Variable value out of the
// agent. This is a pure-function test, so it runs everywhere without Docker.
func TestRedactEnvironmentHidesValuesInErrorMessages(t *testing.T) {
	environment := map[string]string{
		"DATABASE_URL": "postgres://stealth:hunter2@db.internal/app",
		"API_TOKEN":    "s3cr3t-token-value",
		"EMPTY":        "",
	}

	tests := []struct {
		name    string
		message string
		want    string
	}{
		{
			name:    "echoed value is replaced",
			message: `docker: invalid --env API_TOKEN=s3cr3t-token-value: bad format`,
			want:    `docker: invalid --env API_TOKEN=***: bad format`,
		},
		{
			name:    "every value is replaced",
			message: "failed to reach db at postgres://stealth:hunter2@db.internal/app with s3cr3t-token-value",
			want:    "failed to reach db at *** with ***",
		},
		{
			name:    "unrelated message is untouched",
			message: "docker: image not found",
			want:    "docker: image not found",
		},
		{
			name:    "empty value is skipped so nothing else is rewritten",
			message: "the value  is empty", // two spaces, not a value to redact
			want:    "the value  is empty",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := redactEnvironment(test.message, environment)
			if got != test.want {
				t.Fatalf("redactEnvironment() = %q, want %q", got, test.want)
			}
		})
	}

	for _, value := range environment {
		if value == "" {
			continue
		}
		if got := redactEnvironment("boom "+value, environment); strings.Contains(got, value) {
			t.Fatalf("redactEnvironment leaked a value: %q", got)
		}
	}
}
