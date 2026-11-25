package runtime

import (
	"context"
	"testing"
)

func TestUsageMeasuresServicesAndDatabases(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	docker.containers["svc-1"] = &fakeContainer{
		ID:    "svc-1",
		Name:  "stealth-svc-service-1",
		State: "running",
		Labels: map[string]string{
			LabelType:       ResourceTypeService,
			LabelServiceID:  "service-1",
			LabelVolumeName: "stealth-vol-service-1",
		},
	}
	docker.stats["svc-1"] = ContainerStats{CPUUsage: 0.25, MemoryUsageMB: 128}
	docker.volumes["stealth-vol-service-1"] = &fakeVolume{
		Name:    "stealth-vol-service-1",
		UsageMB: 40,
	}

	// A stopped Service keeps its container but consumes nothing.
	docker.containers["svc-2"] = &fakeContainer{
		ID:    "svc-2",
		Name:  "stealth-svc-service-2",
		State: "exited",
		Labels: map[string]string{
			LabelType:      ResourceTypeService,
			LabelServiceID: "service-2",
		},
	}
	docker.stats["svc-2"] = ContainerStats{CPUUsage: 0.9, MemoryUsageMB: 300}

	// A Database has no container of its own: the shared server is what carries
	// the ResourceTypeDatabase label, and usage is the size of the tenant schema.
	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:         SharedPostgresContainerName,
		Network:      "stealth_default",
		NetworkAlias: SharedPostgresContainerName,
		Image:        SharedPostgresImage,
		Port:         DatabasePort,
		Labels:       map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		t.Fatalf("seed the shared server: %v", err)
	}
	docker.tenantUsage = map[string]int64{schemaNameFor("database-1"): 200}
	docker.tenantList = map[string][]string{
		SharedPostgresContainerName: {schemaNameFor("database-1")},
	}

	report, err := manager.Usage(context.Background())
	if err != nil {
		t.Fatalf("usage: %v", err)
	}
	if report.CapturedAt.IsZero() {
		t.Fatal("expected a capture time")
	}

	services := make(map[string]ServiceUsage, len(report.Services))
	for _, service := range report.Services {
		services[service.ServiceID] = service
	}
	if got := services["service-1"]; got.CPUUsage != 0.25 || got.MemoryUsageMB != 128 || got.VolumeUsageMB != 40 {
		t.Fatalf("unexpected running Service usage: %+v", got)
	}
	if got := services["service-2"]; got.CPUUsage != 0 || got.MemoryUsageMB != 0 {
		t.Fatalf("expected a stopped Service to report zero, got %+v", got)
	}

	if len(report.Databases) != 1 {
		t.Fatalf("expected one Database, got %+v", report.Databases)
	}
	if report.Databases[0].DatabaseName != schemaNameFor("database-1") || report.Databases[0].UsageMB != 200 {
		t.Fatalf("unexpected Database usage: %+v", report.Databases[0])
	}
}

func TestParseDockerStats(t *testing.T) {
	cases := []struct {
		cpu  string
		want float64
	}{
		{"0.00%", 0},
		{"12.50%", 0.125},
		{"150.00%", 1.5},
		{"invalid", 0},
	}
	for _, testCase := range cases {
		if got := parseCPUPercent(testCase.cpu); got != testCase.want {
			t.Fatalf("parseCPUPercent(%q) = %v, want %v", testCase.cpu, got, testCase.want)
		}
	}

	memory := []struct {
		usage string
		want  int64
	}{
		{"0B / 0B", 0},
		{"512KiB / 1GiB", 1},
		{"12.5MiB / 512MiB", 13},
		{"1GiB / 2GiB", 1024},
		{"garbage", 0},
	}
	for _, testCase := range memory {
		if got := parseMemoryMB(testCase.usage); got != testCase.want {
			t.Fatalf("parseMemoryMB(%q) = %v, want %v", testCase.usage, got, testCase.want)
		}
	}
}
