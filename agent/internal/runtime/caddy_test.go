package runtime

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfigureOnDemandTLSCreatesThePolicyAndPermission(t *testing.T) {
	var putBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/config/apps/tls/automation" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if r.Method == http.MethodPut && r.URL.Path == "/config/apps/tls/automation" {
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &putBody)
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	router := NewCaddyRouter(server.URL)
	if err := router.ConfigureOnDemandTLS(context.Background(), "http://control-plane/api/internal/caddy/ask?token=secret"); err != nil {
		t.Fatalf("configure: %v", err)
	}

	policies, ok := putBody["policies"].([]any)
	if !ok || len(policies) == 0 {
		t.Fatalf("expected a policy list, got %#v", putBody["policies"])
	}
	first, ok := policies[0].(map[string]any)
	if !ok || first["on_demand"] != true {
		t.Fatalf("expected the first policy to enable on-demand, got %#v", policies[0])
	}

	onDemand, ok := putBody["on_demand"].(map[string]any)
	if !ok {
		t.Fatalf("expected on_demand settings, got %#v", putBody["on_demand"])
	}
	permission, ok := onDemand["permission"].(map[string]any)
	if !ok || permission["module"] != "http" {
		t.Fatalf("expected an http permission, got %#v", onDemand["permission"])
	}
	if permission["endpoint"] != "http://control-plane/api/internal/caddy/ask?token=secret" {
		t.Fatalf("unexpected endpoint: %#v", permission["endpoint"])
	}
}

func TestConfigureOnDemandTLSKeepsExistingPolicies(t *testing.T) {
	var putBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/config/apps/tls/automation" {
			_, _ = w.Write([]byte(`{"policies":[{"issuers":[{"module":"internal"}]}]}`))
			return
		}
		if r.Method == http.MethodPatch && r.URL.Path == "/config/apps/tls/automation" {
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &putBody)
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	router := NewCaddyRouter(server.URL)
	if err := router.ConfigureOnDemandTLS(context.Background(), "http://control-plane/api/internal/caddy/ask"); err != nil {
		t.Fatalf("configure: %v", err)
	}

	policies, _ := putBody["policies"].([]any)
	if len(policies) != 1 {
		t.Fatalf("expected the existing catch-all policy to be reused, got %#v", policies)
	}
	first, _ := policies[0].(map[string]any)
	if first["on_demand"] != true {
		t.Fatalf("expected the catch-all policy to enable on-demand, got %#v", policies[0])
	}
	if _, ok := first["issuers"]; !ok {
		t.Fatalf("expected the existing issuer policy to survive, got %#v", policies[0])
	}
}
