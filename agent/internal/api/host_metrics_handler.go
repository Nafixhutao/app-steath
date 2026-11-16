package api

import (
	"net/http"

	"stealth/agent/internal/hostmetrics"
)

// HostMetricsProvider reports the node's own resource usage. The agent exposes
// this instead of a hostmetrics detail so the API stays independent of how the
// sampling is performed.
type HostMetricsProvider interface {
	Snapshot() hostmetrics.Snapshot
}

// GetHostMetrics reports the node's own CPU, memory, and storage usage. The
// Control Plane stores the sample as NodeHostMetrics for the Platform Admin
// host dashboard, so the response is a single snapshot: the latest sample plus
// the collector's short in-memory history.
func (s server) GetHostMetrics(w http.ResponseWriter, r *http.Request) {
	if s.hostMetrics == nil {
		writeError(w, http.StatusServiceUnavailable, "host_metrics_unavailable", "The host metrics collector is not running on this node.")
		return
	}

	snapshot := s.hostMetrics.Snapshot()
	writeJSON(w, http.StatusOK, snapshot)
}
