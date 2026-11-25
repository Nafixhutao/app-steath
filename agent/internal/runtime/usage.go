package runtime

import (
	"context"
	"log"
	"time"
)

// UsageReport is the node's view of the resources it currently owns. The
// Control Plane stores it as UsageSnapshots, so the dashboard does not have to
// ask Docker on every request.
type UsageReport struct {
	CapturedAt time.Time
	Services   []ServiceUsage
	Databases  []DatabaseUsage
}

// ServiceUsage is the measured usage of one Service container. CPUUsage is in
// vCPU. A stopped Service reports zero because it consumes no CPU or memory.
type ServiceUsage struct {
	ServiceID     string
	CPUUsage      float64
	MemoryUsageMB int64
	VolumeUsageMB int64
}

// DatabaseUsage is the storage one Database's schema currently uses. A Database
// has no container and no Volume of its own, so it is identified by the schema
// name the Agent created for it.
type DatabaseUsage struct {
	DatabaseName string
	UsageMB      int64
}

// Usage measures every Service and Database on the node. A resource whose
// container is gone is simply absent from the report; the Control Plane treats
// an absent entry as zero usage. A failed measurement is logged and recorded as
// zero rather than failing the whole report, so one broken container cannot hide
// the rest of the Organization's usage.
func (m *Manager) Usage(ctx context.Context) (UsageReport, error) {
	report := UsageReport{CapturedAt: m.clock().UTC()}

	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeService})
	if err != nil {
		return UsageReport{}, err
	}

	for _, container := range containers {
		serviceID := container.Labels[LabelServiceID]
		if serviceID == "" {
			continue
		}

		usage := ServiceUsage{ServiceID: serviceID}
		if container.Running() {
			stats, err := m.docker.ContainerStats(ctx, container.ID)
			if err != nil {
				log.Printf("usage: could not read stats for Service %s: %v", serviceID, err)
			} else {
				usage.CPUUsage = stats.CPUUsage
				usage.MemoryUsageMB = stats.MemoryUsageMB
			}
		}

		if name := container.Labels[LabelVolumeName]; name != "" {
			if megabytes, exists, err := m.docker.VolumeUsage(ctx, name); err == nil && exists {
				usage.VolumeUsageMB = megabytes
			}
		}

		report.Services = append(report.Services, usage)
	}

	// A Database has no container of its own, so usage is reported per schema.
	// The schema name is a truncated hash and cannot be reversed into the
	// Database id, so the Control Plane, which knows both, joins them.
	for _, engine := range []string{DatabaseEngineMySQL, DatabaseEnginePostgres} {
		for _, tenant := range m.tenants(ctx, engine) {
			report.Databases = append(report.Databases, DatabaseUsage{
				DatabaseName: tenant.schema,
				UsageMB:      m.tenantUsage(ctx, engine, tenant.schema),
			})
		}
	}

	return report, nil
}
