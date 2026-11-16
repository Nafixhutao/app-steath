package heartbeat

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"stealth/agent/internal/api"
)

type staticInfo struct{ info api.NodeInfo }

func (s staticInfo) NodeInfo() api.NodeInfo { return s.info }

func nodeInfo() api.NodeInfo {
	name := "node-1"
	dockerVersion := "29.9.2"

	return api.NodeInfo{
		Name:              &name,
		Status:            api.NodeInfoStatusOk,
		DockerVersion:     dockerVersion,
		BuildkitAvailable: true,
	}
}

func TestSenderPostsCapacityWithTheAgentToken(t *testing.T) {
	received := make(chan map[string]any, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("expected the agent token, got %q", r.Header.Get("Authorization"))
		}

		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode heartbeat: %v", err)
		}
		received <- body

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"status":"healthy"}}`))
	}))
	defer server.Close()

	sender := New(server.URL, "test-token", time.Hour, staticInfo{info: nodeInfo()})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go sender.Run(ctx)

	select {
	case body := <-received:
		capacity, ok := body["capacity"].(map[string]any)
		if !ok {
			t.Fatalf("expected a capacity object, got %v", body)
		}
		if capacity["dockerVersion"] != "29.9.2" {
			t.Fatalf("expected the Docker version in the heartbeat, got %v", capacity["dockerVersion"])
		}
		if capacity["buildkitAvailable"] != true {
			t.Fatalf("expected BuildKit availability in the heartbeat, got %v", capacity["buildkitAvailable"])
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no heartbeat was received")
	}
}

func TestSenderKeepsGoingWhenTheControlPlaneIsDown(t *testing.T) {
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"status":"healthy"}}`))
	}))
	defer server.Close()

	sender := New(server.URL, "test-token", 20*time.Millisecond, staticInfo{info: nodeInfo()})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	go sender.Run(ctx)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if attempts >= 2 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected the sender to retry after a failure, got %d attempts", attempts)
}
