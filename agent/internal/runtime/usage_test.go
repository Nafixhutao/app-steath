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

	docker.containers["db-1"] = &fakeContainer{
		ID:    "db-1",
		Name:  "stealth-db-database-1",
		State: "running",
		Labels: map[string]string{
			LabelType:       ResourceTypeDatabase,
			LabelDatabaseID: "database-1",
		},
	}
	docker.volumes["stealth-dbvol-database-1"] = &fakeVolume{
		Name:    "stealth-dbvol-database-1",
		UsageMB: 200,
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
	if report.Databases[0].DatabaseID != "database-1" || report.Databases[0].UsageMB != 200 {
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
