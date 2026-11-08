package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Route is one hostname the agent wants Caddy to serve.
type Route struct {
	Hostname string
	// Upstream is the `host:port` Caddy dials inside the Project network.
	Upstream string
	// ServiceID and DeploymentID are carried so reconcile can tell which
	// container a route belongs to.
	ServiceID    string
	DeploymentID string
}

// Router programs Caddy's reverse proxy. The admin API is used instead of
// rewriting a config file, so a route swap is a single atomic request and never
// leaves Caddy with a half-written configuration.
type Router interface {
	// PutRoute makes hostname serve upstream, replacing any previous target.
	PutRoute(ctx context.Context, route Route) error
	// DeleteRoute removes the route for a hostname. Deleting an unknown hostname
	// succeeds, so the call is idempotent.
	DeleteRoute(ctx context.Context, hostname string) error
	// ListRoutes returns every route the agent has programmed.
	ListRoutes(ctx context.Context) ([]Route, error)
}

// NetworkAttacher makes the routing tier reachable from a Project network. Caddy
// runs as a container, so it can only resolve the `svc-...` alias of a Service
// once it is a member of that Project's network.
type NetworkAttacher interface {
	JoinProjectNetwork(ctx context.Context, network string) error
}

// caddyServerID names the Caddy server the agent manages. The Control Plane's own
// site is configured separately, so the agent only ever rewrites this one.
const caddyServerID = "stealth"

// CaddyRouter talks to the Caddy admin API.
type CaddyRouter struct {
	adminURL string
	client   *http.Client
	// Routes are rewritten with read-modify-write, so two concurrent callers
	// must not interleave their reads and writes.
	mu sync.Mutex
}

// NewCaddyRouter returns a Router for the Caddy admin endpoint, for example
// `http://127.0.0.1:2019`.
func NewCaddyRouter(adminURL string) *CaddyRouter {
	return &CaddyRouter{
		adminURL: strings.TrimRight(adminURL, "/"),
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// caddyRoute is the Caddy JSON for one reverse proxy route.
func caddyRoute(route Route) map[string]any {
	return map[string]any{
		"match": []any{
			map[string]any{
				"host": []string{route.Hostname},
			},
		},
		"handle": []any{
			map[string]any{
				"handler": "reverse_proxy",
				"upstreams": []any{
					map[string]any{"dial": route.Upstream},
				},
				"headers": map[string]any{
					"request": map[string]any{
						"set": map[string]any{
							// The Service sees the original host, so frameworks
							// that build absolute URLs keep working.
							"X-Forwarded-Host": []string{"{http.request.host}"},
						},
					},
				},
			},
		},
		"terminal": true,
	}
}

// PutRoute adds or replaces the route for a hostname. The whole route list is
// written in one request, so Caddy never serves a hostname that has both the old
// and the new upstream.
func (r *CaddyRouter) PutRoute(ctx context.Context, route Route) error {
	if route.Hostname == "" || route.Upstream == "" {
		return errors.New("route needs a hostname and an upstream")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	routes, exists, err := r.readRoutes(ctx)
	if err != nil {
		return err
	}

	updated := make([]map[string]any, 0, len(routes)+1)
	updated = append(updated, caddyRoute(route))
	for _, existing := range routes {
		if hostnameOf(existing) == route.Hostname {
			continue
		}
		updated = append(updated, existing)
	}

	return r.writeRoutes(ctx, updated, exists)
}

// DeleteRoute removes the route for a hostname.
func (r *CaddyRouter) DeleteRoute(ctx context.Context, hostname string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	routes, exists, err := r.readRoutes(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}

	remaining := make([]map[string]any, 0, len(routes))
	for _, existing := range routes {
		if hostnameOf(existing) == hostname {
			continue
		}
		remaining = append(remaining, existing)
	}

	if len(remaining) == len(routes) {
		// Nothing to remove; the caller wanted it gone and it already is.
		return nil
	}

	return r.writeRoutes(ctx, remaining, true)
}

// ListRoutes reads back the routes the agent owns, so reconcile can compare what
// Caddy serves with what the containers say should be served.
func (r *CaddyRouter) ListRoutes(ctx context.Context) ([]Route, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	raw, _, err := r.readRoutes(ctx)
	if err != nil {
		return nil, err
	}

	routes := make([]Route, 0, len(raw))
	for _, entry := range raw {
		hostname := hostnameOf(entry)
		if hostname == "" {
			continue
		}

		routes = append(routes, Route{
			Hostname: hostname,
			Upstream: upstreamOf(entry),
		})
	}

	return routes, nil
}

// readRoutes returns the raw route list. The boolean reports whether the route
// key exists at all, which decides between creating it and replacing it: Caddy
// rejects a PUT onto an existing key and a PATCH onto a missing one.
//
// A missing key is not always an error: `GET` on a path below the server answers
// `null` with 200 once the key has been deleted, so a null body means "absent"
// rather than "empty list".
func (r *CaddyRouter) readRoutes(ctx context.Context) ([]map[string]any, bool, error) {
	body, err := r.get(ctx, "/config/apps/http/servers/"+caddyServerID+"/routes")
	if err != nil {
		if isMissing(err) {
			return nil, false, nil
		}
		return nil, false, err
	}

	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return nil, false, nil
	}

	var routes []map[string]any
	if err := json.Unmarshal(trimmed, &routes); err != nil {
		return nil, false, fmt.Errorf("read Caddy routes: %w", err)
	}

	return routes, true, nil
}

// writeRoutes replaces the whole route list. Replacing an existing list is a
// PATCH and creating it is a PUT; both take effect as one atomic config change.
func (r *CaddyRouter) writeRoutes(ctx context.Context, routes []map[string]any, exists bool) error {
	if routes == nil {
		routes = []map[string]any{}
	}

	if err := r.ensureServer(ctx); err != nil {
		return err
	}

	method := http.MethodPut
	if exists {
		method = http.MethodPatch
	}

	return r.send(ctx, method, "/config/apps/http/servers/"+caddyServerID+"/routes", routes)
}

// ensureServer creates the HTTP server the agent routes through when it does not
// exist yet.
func (r *CaddyRouter) ensureServer(ctx context.Context) error {
	_, err := r.get(ctx, "/config/apps/http/servers/"+caddyServerID)
	if err == nil {
		return nil
	}
	if !isMissing(err) {
		return err
	}

	return r.send(ctx, http.MethodPut, "/config/apps/http/servers/"+caddyServerID, map[string]any{
		"listen": []string{":443"},
		// TLS is issued per hostname. The experiment runs on `nip.io` with
		// Caddy's internal CA, so no public DNS or ACME account is needed.
		"tls_connection_policies": []any{map[string]any{}},
	})
}

func hostnameOf(route map[string]any) string {
	match, ok := route["match"].([]any)
	if !ok || len(match) == 0 {
		return ""
	}

	first, ok := match[0].(map[string]any)
	if !ok {
		return ""
	}

	hosts, ok := first["host"].([]any)
	if !ok || len(hosts) == 0 {
		return ""
	}

	hostname, _ := hosts[0].(string)

	return hostname
}

func upstreamOf(route map[string]any) string {
	handle, ok := route["handle"].([]any)
	if !ok || len(handle) == 0 {
		return ""
	}

	first, ok := handle[0].(map[string]any)
	if !ok {
		return ""
	}

	upstreams, ok := first["upstreams"].([]any)
	if !ok || len(upstreams) == 0 {
		return ""
	}

	upstream, ok := upstreams[0].(map[string]any)
	if !ok {
		return ""
	}

	dial, _ := upstream["dial"].(string)

	return dial
}

func (r *CaddyRouter) get(ctx context.Context, path string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.adminURL+path, nil)
	if err != nil {
		return nil, err
	}

	response, err := r.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 400 {
		return nil, &caddyError{status: response.StatusCode, body: string(body)}
	}

	return body, nil
}

func (r *CaddyRouter) send(ctx context.Context, method, path string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	request, err := http.NewRequestWithContext(ctx, method, r.adminURL+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := r.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	body, _ := io.ReadAll(response.Body)
	if response.StatusCode >= 400 {
		return &caddyError{status: response.StatusCode, body: string(body)}
	}

	return nil
}

type caddyError struct {
	status int
	body   string
}

func (e *caddyError) Error() string {
	return fmt.Sprintf("caddy admin API returned %d: %s", e.status, strings.TrimSpace(e.body))
}

// isMissing reports a path that does not exist yet. Caddy answers 404 for an
// unknown object id and 400 for a path traversal into a missing key.
func isMissing(err error) bool {
	var caddyErr *caddyError
	if !errors.As(err, &caddyErr) {
		return false
	}
	if caddyErr.status == http.StatusNotFound {
		return true
	}

	return caddyErr.status == http.StatusBadRequest && strings.Contains(caddyErr.body, "invalid traversal path")
}

// CaddyAttacher joins the Caddy container to a Project network so it can resolve
// the `svc-...` alias of every Service in that Project.
type CaddyAttacher struct {
	docker    Docker
	container string
}

// NewCaddyAttacher returns an attacher that connects the named Caddy container to
// Project networks through docker.
func NewCaddyAttacher(docker Docker, container string) *CaddyAttacher {
	if container == "" {
		container = "stealth-caddy"
	}

	return &CaddyAttacher{docker: docker, container: container}
}

// JoinProjectNetwork attaches Caddy to a Project network. Joining a network it is
// already a member of is treated as success, so this is safe to call on every
// Deploy.
func (a *CaddyAttacher) JoinProjectNetwork(ctx context.Context, network string) error {
	info, err := a.docker.InspectContainer(ctx, a.container)
	if err != nil {
		return fmt.Errorf("find the Caddy container %q: %w", a.container, err)
	}
	if info.OnNetwork(network) {
		return nil
	}

	return a.docker.ConnectNetwork(ctx, network, info.ID, a.container)
}
