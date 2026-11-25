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

func TestSuspensionRouteReturns503AndIsVisibleToReconcile(t *testing.T) {
	route := caddyRoute(Route{Hostname: "app.example.test", Suspended: true})
	if !isSuspensionRoute(route) {
		t.Fatalf("expected suspension route, got %#v", route)
	}
	handlers := route["handle"].([]any)
	first := handlers[0].(map[string]any)
	if first["status_code"] != 503 {
		t.Fatalf("expected 503 response, got %#v", first["status_code"])
	}
}

func TestRouteOverwritesClientIPHeaders(t *testing.T) {
	route := caddyRoute(Route{Hostname: "app.example.test", Upstream: "svc:8080"})
	handlers := route["handle"].([]any)
	proxy := handlers[0].(map[string]any)

	headers, ok := proxy["headers"].(map[string]any)
	if !ok {
		t.Fatalf("expected reverse_proxy headers, got %#v", proxy["headers"])
	}
	requestHeaders, ok := headers["request"].(map[string]any)
	if !ok {
		t.Fatalf("expected request headers, got %#v", headers["request"])
	}
	set, ok := requestHeaders["set"].(map[string]any)
	if !ok {
		t.Fatalf("expected header set, got %#v", requestHeaders["set"])
	}
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		values, ok := set[header].([]string)
		if !ok || len(values) != 1 || values[0] != "{http.request.remote.host}" {
			t.Fatalf("expected %s to be overwritten with the peer address, got %#v", header, set[header])
		}
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

// The phpMyAdmin host carries two routes: its UI for every path and the sign-in
// bridge for one prefix. Both are written through PutRoute, so the second must
// not replace the first, and the narrower one must be evaluated first because a
// whole-host route is terminal.
func TestPathScopedRouteCoexistsWithTheWholeHostRoute(t *testing.T) {
	stored := []map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/config/apps/http/servers/stealth/routes":
			_ = json.NewEncoder(w).Encode(stored)
		case r.Method == http.MethodPut && r.URL.Path == "/config/apps/http/servers/stealth":
			w.WriteHeader(http.StatusOK)
		case (r.Method == http.MethodPut || r.Method == http.MethodPatch) &&
			r.URL.Path == "/config/apps/http/servers/stealth/routes":
			raw, _ := io.ReadAll(r.Body)
			stored = nil
			_ = json.Unmarshal(raw, &stored)
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	router := NewCaddyRouter(server.URL)
	host := "pma.example.test"
	if err := router.PutRoute(context.Background(), Route{
		Hostname: host,
		Upstream: "pma:80",
	}); err != nil {
		t.Fatalf("put UI route: %v", err)
	}
	if err := router.PutRoute(context.Background(), Route{
		Hostname:  host,
		Path:      "/_sso*",
		Upstream:  "control-plane:3000",
		RewriteTo: "/api/phpmyadmin/sso",
	}); err != nil {
		t.Fatalf("put bridge route: %v", err)
	}

	if len(stored) != 2 {
		t.Fatalf("expected the two routes to coexist, got %#v", stored)
	}
	// The path route is written first because Caddy stops at the first terminal
	// match: a whole-host route ahead of it would swallow the bridge.
	if pathOf(stored[0]) != "/_sso*" {
		t.Fatalf("expected the path route first, got %#v", stored[0])
	}
	if pathOf(stored[1]) != "" {
		t.Fatalf("expected the whole-host route last, got %#v", stored[1])
	}

	handlers, _ := stored[0]["handle"].([]any)
	first, _ := handlers[0].(map[string]any)
	if first["handler"] != "rewrite" || first["uri"] != "/api/phpmyadmin/sso" {
		t.Fatalf("expected the bridge to rewrite to the API path, got %#v", handlers[0])
	}
}

// Re-programming the bridge must replace only itself, so a reconcile after a
// restart does not accumulate a second copy of the same route.
func TestPutRouteIsIdempotentPerHostAndPath(t *testing.T) {
	stored := []map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(stored)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		stored = nil
		_ = json.Unmarshal(raw, &stored)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	router := NewCaddyRouter(server.URL)
	route := Route{Hostname: "pma.example.test", Path: "/_sso*", Upstream: "control-plane:3000"}
	for i := 0; i < 3; i += 1 {
		if err := router.PutRoute(context.Background(), route); err != nil {
			t.Fatalf("put %d: %v", i, err)
		}
	}

	if len(stored) != 1 {
		t.Fatalf("expected one route after repeated writes, got %d", len(stored))
	}
}
