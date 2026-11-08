package runtime

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

// These tests cover the ticket 08 cleanup rules: a cancel must not leave a
// container or image behind, only the newest three images per Service survive,
// and the Build cache is pruned at most once a week.

func TestAbortRemovesTheCandidateAndItsImage(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	request := sampleRequest()
	if _, err := manager.Deploy(context.Background(), request); err != nil {
		t.Fatalf("deploy: %v", err)
	}

	// The deployed container is the live Service, so Abort must not remove it.
	result, err := manager.Abort(context.Background(), AbortRequest{
		DeploymentID: request.DeploymentID,
		ServiceID:    request.ServiceID,
		ImageRef:     request.ImageRef,
	})
	if err != nil {
		t.Fatalf("abort: %v", err)
	}
	if result.ContainersRemoved != 0 {
		t.Fatalf("expected the serving container to be kept, removed %d", result.ContainersRemoved)
	}
	if _, ok := docker.find("stealth-svc-service-1"); !ok {
		t.Fatal("expected the serving container to survive the cancel")
	}
	if _, ok := router.route(request.Hostname); !ok {
		t.Fatal("expected the route to be untouched by the cancel")
	}
}

func TestAbortRemovesACandidateThatNeverTookTraffic(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	// A candidate left behind by a Deployment that was cancelled mid-health-check.
	docker.containers["container-1"] = &fakeContainer{
		ID:    "container-1",
		Name:  "stealth-svc-service-1-candidate",
		State: "running",
		Image: "stealth/service-service-1:deployment-1",
		Labels: map[string]string{
			LabelType:         ResourceTypeService,
			LabelServiceID:    "service-1",
			LabelDeploymentID: "deployment-1",
		},
		Networks: map[string]string{},
	}
	docker.images["stealth/service-service-1:deployment-1"] = time.Now()

	result, err := manager.Abort(context.Background(), AbortRequest{
		DeploymentID: "deployment-1",
		ServiceID:    "service-1",
		ImageRef:     "stealth/service-service-1:deployment-1",
	})
	if err != nil {
		t.Fatalf("abort: %v", err)
	}
	if result.ContainersRemoved != 1 {
		t.Fatalf("expected the candidate to be removed, got %d", result.ContainersRemoved)
	}
	if !result.ImageRemoved {
		t.Fatal("expected the orphaned image to be removed")
	}
	if _, ok := docker.images["stealth/service-service-1:deployment-1"]; ok {
		t.Fatal("expected the image to be gone")
	}
}

func TestAbortKeepsAnImageStillUsedByAContainer(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	// The image is used by the container that is serving, so it is not garbage.
	docker.containers["container-1"] = &fakeContainer{
		ID:     "container-1",
		Name:   "stealth-svc-service-1",
		State:  "running",
		Image:  "stealth/service-service-1:deployment-1",
		Labels: map[string]string{LabelServiceID: "service-1"},
	}
	docker.images["stealth/service-service-1:deployment-1"] = time.Now()

	result, err := manager.Abort(context.Background(), AbortRequest{
		DeploymentID: "deployment-2",
		ServiceID:    "service-1",
		ImageRef:     "stealth/service-service-1:deployment-1",
	})
	if err != nil {
		t.Fatalf("abort: %v", err)
	}
	if result.ImageRemoved {
		t.Fatal("expected an image in use to be kept")
	}
	if _, ok := docker.images["stealth/service-service-1:deployment-1"]; !ok {
		t.Fatal("expected the image to still exist")
	}
}

func TestAbortRejectsAnIncompleteRequest(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	if _, err := manager.Abort(context.Background(), AbortRequest{DeploymentID: "deployment-1"}); !errors.Is(err, ErrInvalidDeploy) {
		t.Fatalf("expected ErrInvalidDeploy for a missing service id, got %v", err)
	}
}

func TestPruneImagesKeepsTheNewestThreePerService(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	base := time.Now().Add(-5 * time.Hour)
	for index := 0; index < 5; index++ {
		docker.images["stealth/service-service-1:deployment-"+string(rune('1'+index))] = base.Add(time.Duration(index) * time.Hour)
	}
	// A different Service keeps its own three.
	for index := 0; index < 4; index++ {
		docker.images["stealth/service-service-2:deployment-"+string(rune('1'+index))] = base.Add(time.Duration(index) * time.Hour)
	}

	removed, err := manager.PruneImages(context.Background())
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	// Five and four images, three kept each, so three are removed in total.
	if removed != 3 {
		t.Fatalf("expected three images to be removed, got %d", removed)
	}

	for _, ref := range []string{
		"stealth/service-service-1:deployment-1",
		"stealth/service-service-1:deployment-2",
		"stealth/service-service-2:deployment-1",
	} {
		if _, ok := docker.images[ref]; ok {
			t.Fatalf("expected the oldest image %s to be removed", ref)
		}
	}
	for _, ref := range []string{
		"stealth/service-service-1:deployment-5",
		"stealth/service-service-2:deployment-4",
	} {
		if _, ok := docker.images[ref]; !ok {
			t.Fatalf("expected the newest image %s to be kept", ref)
		}
	}
}

func TestPruneImagesKeepsAnImageAStoppedContainerNeeds(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	base := time.Now().Add(-5 * time.Hour)
	for index := 0; index < 4; index++ {
		docker.images["stealth/service-service-1:deployment-"+string(rune('1'+index))] = base.Add(time.Duration(index) * time.Hour)
	}
	// A stopped Service still needs its image to start again, so the oldest
	// image must survive even though it is outside the retention window.
	docker.containers["container-1"] = &fakeContainer{
		ID:     "container-1",
		Name:   "stealth-svc-service-1",
		State:  "exited",
		Image:  "stealth/service-service-1:deployment-1",
		Labels: map[string]string{LabelServiceID: "service-1"},
	}

	if _, err := manager.PruneImages(context.Background()); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, ok := docker.images["stealth/service-service-1:deployment-1"]; !ok {
		t.Fatal("expected the image of a stopped container to be kept")
	}
}

func TestCleanupRemovesLeftoverCandidatesAndPrunesOnceAWeek(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetCleanupStatePath(filepath.Join(t.TempDir(), "cleanup.json"))

	docker.containers["container-1"] = &fakeContainer{
		ID:       "container-1",
		Name:     "stealth-svc-service-1-candidate",
		State:    "running",
		Labels:   map[string]string{LabelType: ResourceTypeService},
		Networks: map[string]string{},
	}

	report, err := manager.Cleanup(context.Background())
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if report.ContainersRemoved != 1 {
		t.Fatalf("expected the leftover candidate to be removed, got %d", report.ContainersRemoved)
	}
	if !report.CachePruned {
		t.Fatal("expected the first cleanup to prune the Build cache")
	}
	if docker.pruneCalls != 1 {
		t.Fatalf("expected one prune call, got %d", docker.pruneCalls)
	}

	// A second cleanup within the week must not prune again: the cache is what
	// makes repeat Builds fast.
	if _, err := manager.Cleanup(context.Background()); err != nil {
		t.Fatalf("second cleanup: %v", err)
	}
	if docker.pruneCalls != 1 {
		t.Fatalf("expected the weekly prune to be skipped, got %d calls", docker.pruneCalls)
	}
}

func TestCleanupPrunesAgainAfterAWeek(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	statePath := filepath.Join(t.TempDir(), "cleanup.json")
	manager.SetCleanupStatePath(statePath)

	now := time.Now()
	manager.clock = func() time.Time { return now }

	if _, err := manager.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

	// Eight days later the cache is old enough to trim again.
	now = now.Add(8 * 24 * time.Hour)
	report, err := manager.Cleanup(context.Background())
	if err != nil {
		t.Fatalf("second cleanup: %v", err)
	}
	if !report.CachePruned {
		t.Fatal("expected the cleanup a week later to prune the Build cache")
	}
	if docker.pruneCalls != 2 {
		t.Fatalf("expected two prune calls, got %d", docker.pruneCalls)
	}
}

func TestCleanupWithoutAStatePathSkipsTheCachePrune(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	report, err := manager.Cleanup(context.Background())
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if report.CachePruned {
		t.Fatal("expected no prune without a state path")
	}
	if docker.pruneCalls != 0 {
		t.Fatalf("expected no prune call, got %d", docker.pruneCalls)
	}
}
