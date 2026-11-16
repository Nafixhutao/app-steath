package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"stealth/agent/internal/build"
	"stealth/agent/internal/hostmetrics"
)

// stubHostMetrics returns a fixed snapshot so the API test can assert how the
// host sample is encoded without reading /proc.
type stubHostMetrics struct {
	snapshot hostmetrics.Snapshot
	called   int
}

func (s *stubHostMetrics) Snapshot() hostmetrics.Snapshot {
	s.called++
	return s.snapshot
}

func newTestHandlerWithHostMetrics(t *testing.T, provider HostMetricsProvider) http.Handler {
	t.Helper()

	manager := build.NewManager(t.TempDir(), &stubExecutor{})
	return NewHandler("test-token", manager, newNodeInfo(), nil, nil, provider)
}

func TestHostMetricsReportsTheSnapshot(t *testing.T) {
	provider := &stubHostMetrics{snapshot: hostmetrics.Snapshot{
		Current: hostmetrics.Sample{
			Timestamp:      time.Date(2026, 1, 15, 9, 30, 0, 0, time.UTC),
			CPUPercent:     12.5,
			MemoryUsedMB:   2048,
			MemoryTotalMB:  8192,
			StorageUsedMB:  51200,
			StorageTotalMB: 204800,
		},
		History: []hostmetrics.Sample{{
			Timestamp:  time.Date(2026, 1, 15, 9, 29, 0, 0, time.UTC),
			CPUPercent: 9.25,
		}},
	}}
	handler := newTestHandlerWithHostMetrics(t, provider)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, authorized("GET", "/v1/host-metrics", ""))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}

	var payload struct {
		Current struct {
			CapturedAt     string  `json:"capturedAt"`
			CPUPercent     float64 `json:"cpuPercent"`
			MemoryUsedMb   int64   `json:"memoryUsedMb"`
			MemoryTotalMb  int64   `json:"memoryTotalMb"`
			StorageUsedMb  int64   `json:"storageUsedMb"`
			StorageTotalMb int64   `json:"storageTotalMb"`
		} `json:"current"`
		History []struct {
			CPUPercent float64 `json:"cpuPercent"`
		} `json:"history"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if payload.Current.CPUPercent != 12.5 || payload.Current.MemoryUsedMb != 2048 {
		t.Fatalf("unexpected current sample: %+v", payload.Current)
	}
	if len(payload.History) != 1 || payload.History[0].CPUPercent != 9.25 {
		t.Fatalf("unexpected history: %+v", payload.History)
	}
}

func TestHostMetricsIsUnavailableWithoutCollector(t *testing.T) {
	handler := newTestHandlerWithHostMetrics(t, nil)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, authorized("GET", "/v1/host-metrics", ""))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(recorder.Body.String(), "host_metrics_unavailable") {
		t.Fatalf("expected the host_metrics_unavailable code, got %s", recorder.Body.String())
	}
}

func TestHostMetricsRejectsMissingToken(t *testing.T) {
	provider := &stubHostMetrics{}
	handler := newTestHandlerWithHostMetrics(t, provider)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/v1/host-metrics", nil)
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if provider.called != 0 {
		t.Fatalf("the collector must not be read without a token")
	}
}
