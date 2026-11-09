package runtime

import (
	"context"
	"errors"
	"testing"
)

// runningService puts a Service container with the labels AddHostname needs
// into the fake Docker daemon.
func runningService(docker *fakeDocker, serviceID, deploymentID, alias, port string) {
	docker.containers["container-"+serviceID] = &fakeContainer{
		ID:    "container-" + serviceID,
		Name:  serviceContainerName(serviceID),
		State: "running",
		Labels: map[string]string{
			LabelType:         ResourceTypeService,
			LabelServiceID:    serviceID,
			LabelProjectID:    "project-1",
			LabelDeploymentID: deploymentID,
			LabelHostname:     "web-abc123.127.0.0.1.nip.io",
			LabelPort:         port,
			LabelAlias:        alias,
		},
		Networks: map[string]string{"stealth-project-project-1": alias},
	}
}

func TestAddHostnameRoutesTheRunningService(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	runningService(docker, "service-1", "deployment-1", "svc-deployment-1", "3000")
	// The Platform Subdomain route already exists and must survive.
	router.routes["web-abc123.127.0.0.1.nip.io"] = Route{
		Hostname: "web-abc123.127.0.0.1.nip.io",
		Upstream: "svc-deployment-1:3000",
	}

	state, err := manager.AddHostname(context.Background(), "service-1", "App.Example.COM.")
	if err != nil {
		t.Fatalf("add hostname: %v", err)
	}
	if state.Hostname != "app.example.com" || !state.Routed {
		t.Fatalf("unexpected state: %+v", state)
	}

	route, ok := router.route("app.example.com")
	if !ok {
		t.Fatal("expected a route for the Custom Domain")
	}
	if route.Upstream != "svc-deployment-1:3000" {
		t.Fatalf("expected the route to dial the container alias, got %q", route.Upstream)
	}
	if route.ServiceID != "service-1" || route.DeploymentID != "deployment-1" {
		t.Fatalf("expected the route to carry the owner ids, got %+v", route)
	}

	if _, ok := router.route("web-abc123.127.0.0.1.nip.io"); !ok {
		t.Fatal("expected the Platform Subdomain route to stay")
	}
}

func TestAddHostnameRejectsMissingAndStoppedServices(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.AddHostname(context.Background(), "service-1", "app.example.com"); !errors.Is(err, ErrUnknownService) {
		t.Fatalf("expected ErrUnknownService, got %v", err)
	}

	runningService(docker, "service-1", "deployment-1", "svc-deployment-1", "3000")
	docker.containers["container-service-1"].State = "exited"

	if _, err := manager.AddHostname(context.Background(), "service-1", "app.example.com"); !errors.Is(err, ErrServiceNotRunning) {
		t.Fatalf("expected ErrServiceNotRunning, got %v", err)
	}
}

func TestAddHostnameRejectsInvalidNames(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	runningService(docker, "service-1", "deployment-1", "svc-deployment-1", "3000")

	for _, hostname := range []string{
		"",
		"https://app.example.com",
		"app.example.com:443",
		"app.example.com/path",
		"*.example.com",
		"localhost",
		"app..example.com",
		"-app.example.com",
	} {
		if _, err := manager.AddHostname(context.Background(), "service-1", hostname); !errors.Is(err, ErrInvalidHostname) {
			t.Fatalf("expected %q to be rejected, got %v", hostname, err)
		}
	}
}

func TestRemoveHostnameWithdrawsTheRoute(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)
	runningService(docker, "service-1", "deployment-1", "svc-deployment-1", "3000")

	if _, err := manager.AddHostname(context.Background(), "service-1", "app.example.com"); err != nil {
		t.Fatalf("add hostname: %v", err)
	}

	state, err := manager.RemoveHostname(context.Background(), "service-1", "app.example.com")
	if err != nil {
		t.Fatalf("remove hostname: %v", err)
	}
	if state.Routed {
		t.Fatalf("expected routed=false, got %+v", state)
	}
	if _, ok := router.route("app.example.com"); ok {
		t.Fatal("expected the route to be removed")
	}
}

func TestReconcileKeepsCustomDomainRoutesOfRunningServices(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()

	runningService(docker, "service-1", "deployment-1", "svc-deployment-1", "3000")
	router.routes["app.example.com"] = Route{
		Hostname: "app.example.com",
		Upstream: "svc-deployment-1:3000",
	}
	// A Custom Domain whose container is gone is stale and must be pruned.
	router.routes["gone.example.com"] = Route{
		Hostname: "gone.example.com",
		Upstream: "svc-deployment-9:3000",
	}

	manager := testManager(t, docker, router)
	if err := manager.Reconcile(context.Background()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if _, ok := router.route("app.example.com"); !ok {
		t.Fatal("expected the Custom Domain route to survive reconcile")
	}
	if _, ok := router.route("gone.example.com"); ok {
		t.Fatal("expected the stale Custom Domain route to be removed")
	}
}

func TestDeployRepointsCustomDomainRoutes(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	// The previous release is serving under its own alias.
	previousAlias := "svc-previous"
	runningService(docker, "service-1", "deployment-0", previousAlias, "3000")
	router.routes["app.example.com"] = Route{
		Hostname: "app.example.com",
		Upstream: upstream(previousAlias, 3000),
	}

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	route, ok := router.route("app.example.com")
	if !ok {
		t.Fatal("expected the Custom Domain route to survive the redeploy")
	}
	want := upstream(deploymentAlias("service-1", "deployment-1"), 3000)
	if route.Upstream != want {
		t.Fatalf("expected the route to move to %q, got %q", want, route.Upstream)
	}
}

func TestRemoveDeletesCustomDomainRoutesOfTheContainer(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.Deploy(context.Background(), sampleRequest()); err != nil {
		t.Fatalf("deploy: %v", err)
	}
	if _, err := manager.AddHostname(context.Background(), "service-1", "app.example.com"); err != nil {
		t.Fatalf("add hostname: %v", err)
	}

	if _, err := manager.Remove(context.Background(), "service-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}

	if _, ok := router.route("app.example.com"); ok {
		t.Fatal("expected the Custom Domain route to be removed with the container")
	}
}
