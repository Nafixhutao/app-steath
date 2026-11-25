package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"stealth/agent/internal/build"
	"stealth/agent/internal/runtime"
)

// stubRuntime satisfies RuntimeDeployer by embedding the interface, so a test
// only has to write the methods it exercises. Any other call panics, which is
// what we want: the test must not drift into behaviour it does not describe.
type stubRuntime struct {
	RuntimeDeployer
	proxyErr error
}

func (s stubRuntime) EnsureDatabaseProxy(
	_ context.Context,
	_ runtime.DatabaseProxyRequest,
) (runtime.DatabaseProxyState, error) {
	return runtime.DatabaseProxyState{}, s.proxyErr
}

// TestDatabaseProxyIsRefusedWithConflict proves the Node Agent answers a shared
// server's proxy request with 409, which is the status the Control Plane turns
// into the product-level refusal. A 500 here would read as a broken node.
func TestDatabaseProxyIsRefusedWithConflict(t *testing.T) {
	manager := build.NewManager(t.TempDir(), &stubExecutor{})
	handler := NewHandler(
		"test-token",
		manager,
		newNodeInfo(),
		stubRuntime{proxyErr: runtime.ErrDatabaseProxyDisabled},
		nil,
		nil,
	)

	request := authorized(
		http.MethodPut,
		"/v1/databases/database-1/proxy",
		`{"databaseId":"database-1","projectId":"project-1","allowlist":["203.0.113.0/24"]}`,
	)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "database_proxy_unsupported" {
		t.Fatalf("expected database_proxy_unsupported, got %q", body.Code)
	}
}
