package runtime

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"
)

// A public Database proxy is an nginx stream server that publishes a unique host
// port and forwards to the private Database over the Project network. It exists
// only while the owner or admin opts in; the Database container itself never
// publishes a port. The connection stays encrypted end to end because PostgreSQL
// terminates TLS itself: libpq starts with a plaintext SSLRequest that a
// generic TLS terminator cannot answer.
const (
	// DatabaseProxyImage is the only proxy image the platform runs. The official
	// Alpine image includes the stream module.
	DatabaseProxyImage = "nginx:alpine"

	// DatabaseProxyPortMin and DatabaseProxyPortMax are the only public ports
	// the proxy may use.
	DatabaseProxyPortMin = 20000
	DatabaseProxyPortMax = 29999

	// DatabaseProxyInternalPort is the port nginx listens on inside its
	// container; Docker maps the allocated public port to it.
	DatabaseProxyInternalPort = 5432

	// DatabaseProxyUser is the unprivileged nginx user. The proxy never needs
	// root because it binds a port above 1024.
	DatabaseProxyUser = "nginx"

	// DatabaseProxyMountPath is where the generated configuration lives inside
	// the proxy container.
	DatabaseProxyMountPath = "/etc/proxy"

	// DatabaseProxyAlias is the proxy's alias on the Project network. It is not
	// used by clients, but it keeps the container addressable for debugging.
	DatabaseProxyAlias = "dbproxy"

	// MaxDatabaseProxyAllowlist keeps a generated nginx configuration bounded.
	MaxDatabaseProxyAllowlist = 50

	// proxyReadyTimeout bounds how long the agent waits for nginx to stay up.
	proxyReadyTimeout = 15 * time.Second
)

// ErrInvalidDatabaseProxy is returned for a proxy request that cannot be
// honoured, such as an empty or malformed allowlist.
var ErrInvalidDatabaseProxy = errors.New("invalid database proxy request")

// ErrDatabaseProxyPortsExhausted is returned when every public port is in use.
var ErrDatabaseProxyPortsExhausted = errors.New("no free database proxy port")

// DatabaseProxyRequest asks the agent to enable or update a public proxy.
type DatabaseProxyRequest struct {
	DatabaseID string
	ProjectID  string
	Allowlist  []string
	// Port is zero on the first enable. A later update reuses the existing port
	// so the published connection string does not change.
	Port int
}

// DatabaseProxyState is what the Control Plane reads back about a proxy.
type DatabaseProxyState struct {
	DatabaseID string
	Enabled    bool
	Port       int
	Allowlist  []string
}

// EnsureDatabaseProxy starts or updates the public TLS listener. It reuses the
// existing port and certificate Volume on an update, so changing the allowlist
// does not revoke a connection string that was already handed out.
func (m *Manager) EnsureDatabaseProxy(
	ctx context.Context,
	request DatabaseProxyRequest,
) (DatabaseProxyState, error) {
	allowlist, err := normalizeProxyAllowlist(request.Allowlist)
	if err != nil {
		return DatabaseProxyState{}, err
	}
	if strings.TrimSpace(request.DatabaseID) == "" {
		return DatabaseProxyState{}, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabaseProxy)
	}
	if strings.TrimSpace(request.ProjectID) == "" {
		return DatabaseProxyState{}, fmt.Errorf("%w: projectId is required", ErrInvalidDatabaseProxy)
	}

	unlock := m.lockService(databaseProxyLockKey(request.DatabaseID))
	defer unlock()

	database, err := m.docker.InspectContainer(ctx, databaseContainerName(request.DatabaseID))
	if err != nil {
		return DatabaseProxyState{}, ErrUnknownDatabase
	}
	if !database.Running() {
		return DatabaseProxyState{}, fmt.Errorf(
			"%w: the Database container is not running",
			ErrUnknownDatabase,
		)
	}
	if projectID := database.Labels[LabelProjectID]; projectID != "" && projectID != request.ProjectID {
		return DatabaseProxyState{}, fmt.Errorf(
			"%w: the Database belongs to another Project",
			ErrInvalidDatabaseProxy,
		)
	}

	network := projectNetwork(request.ProjectID)
	if err := m.docker.EnsureNetwork(ctx, network); err != nil {
		return DatabaseProxyState{}, fmt.Errorf("could not prepare the Project network: %w", err)
	}

	containerName := databaseProxyContainerName(request.DatabaseID)
	preferredPort := request.Port
	if existing, err := m.docker.InspectContainer(ctx, containerName); err == nil {
		if existing.Labels[LabelDatabaseID] != request.DatabaseID {
			return DatabaseProxyState{}, fmt.Errorf(
				"%w: container %s is owned by another Database",
				ErrInvalidDatabaseProxy,
				containerName,
			)
		}
		if labelPort, err := strconv.Atoi(existing.Labels[LabelDatabaseProxyPort]); err == nil && labelPort > 0 {
			preferredPort = labelPort
		}
		// Recreate the listener so a changed allowlist takes effect immediately.
		if err := m.docker.RemoveContainer(ctx, existing.ID, true); err != nil {
			return DatabaseProxyState{}, fmt.Errorf("could not replace the public proxy: %w", err)
		}
	}

	volumeName := databaseProxyVolumeName(request.DatabaseID)
	if err := m.docker.EnsureVolume(ctx, VolumeSpec{
		Name: volumeName,
		Labels: map[string]string{
			LabelType:       ResourceTypeDatabaseProxy,
			LabelProjectID:  request.ProjectID,
			LabelDatabaseID: request.DatabaseID,
		},
	}); err != nil {
		return DatabaseProxyState{}, fmt.Errorf("could not prepare the public proxy Volume: %w", err)
	}
	if err := m.docker.WriteVolumeFiles(ctx, volumeName, []VolumeFile{
		{Name: "nginx.conf", Content: proxyConfig(allowlist), Mode: 0644},
	}); err != nil {
		return DatabaseProxyState{}, fmt.Errorf("could not write the public proxy configuration: %w", err)
	}

	port, err := m.createProxyContainer(ctx, request, allowlist, preferredPort, network, volumeName)
	if err != nil {
		return DatabaseProxyState{}, err
	}

	return DatabaseProxyState{
		DatabaseID: request.DatabaseID,
		Enabled:    true,
		Port:       port,
		Allowlist:  allowlist,
	}, nil
}

// GetDatabaseProxy reports the listener state. A missing container means the
// proxy is disabled, not an error, because the Control Plane may ask while the
// owner is disabling it.
func (m *Manager) GetDatabaseProxy(
	ctx context.Context,
	databaseID string,
) (DatabaseProxyState, error) {
	if strings.TrimSpace(databaseID) == "" {
		return DatabaseProxyState{}, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabaseProxy)
	}

	info, err := m.docker.InspectContainer(ctx, databaseProxyContainerName(databaseID))
	if err != nil {
		return DatabaseProxyState{
			DatabaseID: databaseID,
			Enabled:    false,
			Allowlist:  []string{},
		}, nil
	}

	port, _ := strconv.Atoi(info.Labels[LabelDatabaseProxyPort])

	return DatabaseProxyState{
		DatabaseID: databaseID,
		Enabled:    info.Running(),
		Port:       port,
		Allowlist:  parseProxyAllowlistLabel(info.Labels[LabelDatabaseProxyAllowlist]),
	}, nil
}

// RemoveDatabaseProxy stops the listener and deletes its certificate Volume. A
// proxy that is already gone counts as removed, so disabling is safe to retry.
func (m *Manager) RemoveDatabaseProxy(ctx context.Context, databaseID string) (bool, error) {
	if strings.TrimSpace(databaseID) == "" {
		return false, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabaseProxy)
	}

	unlock := m.lockService(databaseProxyLockKey(databaseID))
	defer unlock()

	removed := false
	if info, err := m.docker.InspectContainer(ctx, databaseProxyContainerName(databaseID)); err == nil {
		_ = m.docker.StopContainer(ctx, info.ID)
		if err := m.docker.RemoveContainer(ctx, info.ID, true); err != nil {
			return removed, err
		}
		removed = true
	}

	volumeRemoved, err := m.docker.RemoveVolume(ctx, databaseProxyVolumeName(databaseID))
	if err != nil {
		return removed, err
	}

	return removed || volumeRemoved, nil
}

// createProxyContainer allocates a free public port and starts nginx. Docker can
// reject a port that another host process already uses, so the loop moves to the
// next free port instead of failing the whole request.
func (m *Manager) createProxyContainer(
	ctx context.Context,
	request DatabaseProxyRequest,
	allowlist []string,
	preferredPort int,
	network string,
	volumeName string,
) (int, error) {
	used, err := m.usedProxyPorts(ctx)
	if err != nil {
		return 0, err
	}

	attempted := make(map[int]bool)
	start := preferredPort
	if start < DatabaseProxyPortMin || start > DatabaseProxyPortMax {
		start = proxyStartPort(request.DatabaseID)
	}

	for offset := 0; offset < DatabaseProxyPortMax-DatabaseProxyPortMin+1; offset++ {
		port := start + offset
		if port > DatabaseProxyPortMax {
			port = DatabaseProxyPortMin + (port - DatabaseProxyPortMax - 1)
		}
		if used[port] || attempted[port] {
			continue
		}
		attempted[port] = true

		_, err := m.docker.CreateContainer(ctx, ContainerSpec{
			Name:          databaseProxyContainerName(request.DatabaseID),
			Network:       network,
			NetworkAlias:  DatabaseProxyAlias,
			Image:         DatabaseProxyImage,
			Port:          DatabaseProxyInternalPort,
			PublishedPort: port,
			CPU:           0.25,
			MemoryMB:      128,
			User:          DatabaseProxyUser,
			Entrypoint:    "nginx",
			Command:       []string{"-c", DatabaseProxyMountPath + "/nginx.conf", "-g", "daemon off;"},
			Volume: &VolumeMount{
				Name:      volumeName,
				MountPath: DatabaseProxyMountPath,
			},
			ReadOnlyRoot: true,
			Labels: map[string]string{
				LabelType:                   ResourceTypeDatabaseProxy,
				LabelProjectID:              request.ProjectID,
				LabelDatabaseID:             request.DatabaseID,
				LabelDatabaseProxyPort:      strconv.Itoa(port),
				LabelDatabaseProxyAllowlist: strings.Join(allowlist, ","),
			},
		})
		if err == nil {
			if err := m.waitProxyReady(ctx, request.DatabaseID); err != nil {
				return 0, err
			}
			return port, nil
		}
		if !isProxyPortConflict(err) {
			return 0, fmt.Errorf("could not start the public proxy: %w", err)
		}
	}

	return 0, ErrDatabaseProxyPortsExhausted
}

// waitProxyReady gives nginx a moment to fail on a bad configuration instead of
// leaving a listener that the Control Plane already announced.
func (m *Manager) waitProxyReady(ctx context.Context, databaseID string) error {
	deadline := m.clock().Add(proxyReadyTimeout)

	for {
		info, err := m.docker.InspectContainer(ctx, databaseProxyContainerName(databaseID))
		if err == nil {
			if info.Running() {
				return nil
			}
			if info.State == "exited" || info.State == "dead" {
				return errors.New("The public proxy exited before it started listening.")
			}
		}

		if !m.clock().Before(deadline) {
			return fmt.Errorf("The public proxy did not start within %s.", proxyReadyTimeout)
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("The public proxy startup was interrupted: %w", ctx.Err())
		case <-time.After(m.pollInterval):
		}
	}
}

// usedProxyPorts collects every host port Docker currently publishes, so a new
// proxy never picks a port that another container already owns.
func (m *Manager) usedProxyPorts(ctx context.Context) (map[int]bool, error) {
	containers, err := m.docker.ListContainers(ctx, nil)
	if err != nil {
		return nil, err
	}

	used := make(map[int]bool)
	for _, container := range containers {
		for _, port := range container.PublishedPorts {
			used[port] = true
		}
	}

	return used, nil
}

// reconcileDatabaseProxies re-attaches proxy containers after a node restart,
// because a removed Project network would otherwise leave the listener alive but
// unable to reach the Database.
func (m *Manager) reconcileDatabaseProxies(ctx context.Context) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabaseProxy})
	if err != nil {
		log.Printf("reconcile database proxies: %v", err)
		return
	}

	for _, container := range containers {
		databaseID := container.Labels[LabelDatabaseID]
		projectID := container.Labels[LabelProjectID]
		if databaseID == "" || projectID == "" {
			continue
		}

		network := projectNetwork(projectID)
		if err := m.docker.EnsureNetwork(ctx, network); err != nil {
			log.Printf("reconcile database proxy %s: could not ensure %s: %v", databaseID, network, err)
			continue
		}
		if container.OnNetwork(network) {
			continue
		}
		if err := m.docker.ConnectNetwork(ctx, network, container.ID, DatabaseProxyAlias); err != nil {
			log.Printf(
				"reconcile database proxy %s: could not attach it to %s: %v",
				databaseID,
				network,
				err,
			)
		}
	}
}

// pruneOrphanDatabaseProxies removes a listener whose Database is gone. It runs
// during cleanup so a deleted Database cannot leave an open public port behind.
func (m *Manager) pruneOrphanDatabaseProxies(ctx context.Context) (int, error) {
	proxies, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabaseProxy})
	if err != nil {
		return 0, err
	}

	databases, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabase})
	if err != nil {
		return 0, err
	}
	live := make(map[string]bool, len(databases))
	for _, database := range databases {
		if databaseID := database.Labels[LabelDatabaseID]; databaseID != "" {
			live[databaseID] = true
		}
	}

	removed := 0
	for _, proxy := range proxies {
		databaseID := proxy.Labels[LabelDatabaseID]
		if databaseID != "" && live[databaseID] {
			continue
		}
		if err := m.docker.RemoveContainer(ctx, proxy.ID, true); err != nil {
			log.Printf("cleanup: could not remove orphan public proxy %s: %v", proxy.Name, err)
			continue
		}
		if _, err := m.docker.RemoveVolume(ctx, databaseProxyVolumeName(databaseID)); err != nil {
			log.Printf("cleanup: could not remove orphan public proxy Volume %s: %v", databaseID, err)
		}
		removed++
	}

	return removed, nil
}

// pruneOrphanDatabaseProxyVolumes removes a certificate Volume whose proxy
// container is gone.
func (m *Manager) pruneOrphanDatabaseProxyVolumes(ctx context.Context) (int, error) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeDatabaseProxy})
	if err != nil {
		return 0, err
	}

	live := make(map[string]bool, len(containers))
	for _, container := range containers {
		if databaseID := container.Labels[LabelDatabaseID]; databaseID != "" {
			live[databaseID] = true
		}
	}

	volumes, err := m.docker.ListVolumes(ctx, map[string]string{LabelType: ResourceTypeDatabaseProxy})
	if err != nil {
		return 0, err
	}

	removed := 0
	for _, volume := range volumes {
		databaseID := volume.Labels[LabelDatabaseID]
		if databaseID != "" && live[databaseID] {
			continue
		}
		if _, err := m.docker.RemoveVolume(ctx, volume.Name); err != nil {
			log.Printf("cleanup: could not remove orphan public proxy Volume %s: %v", volume.Name, err)
			continue
		}
		removed++
	}

	return removed, nil
}

func databaseProxyContainerName(databaseID string) string {
	return "stealth-dbproxy-" + sanitizeID(databaseID)
}

func databaseProxyVolumeName(databaseID string) string {
	return "stealth-dbproxyvol-" + sanitizeID(databaseID)
}

func databaseProxyLockKey(databaseID string) string {
	return "database-proxy:" + databaseID
}

// proxyStartPort hashes the Database id so different Databases usually get
// different starting points and allocation stays cheap.
func proxyStartPort(databaseID string) int {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(databaseID))

	return DatabaseProxyPortMin + int(hash.Sum32()%uint32(DatabaseProxyPortMax-DatabaseProxyPortMin+1))
}

func isProxyPortConflict(err error) bool {
	message := strings.ToLower(err.Error())

	return strings.Contains(message, "port is already allocated") ||
		strings.Contains(message, "address already in use") ||
		strings.Contains(message, "bind for") ||
		strings.Contains(message, "ports are not available")
}

// normalizeProxyAllowlist validates and canonicalizes the source CIDRs. A bare
// IP is accepted as a single-host CIDR; anything that could break the generated
// nginx configuration is rejected.
func normalizeProxyAllowlist(values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("%w: at least one allowlist CIDR is required", ErrInvalidDatabaseProxy)
	}
	if len(values) > MaxDatabaseProxyAllowlist {
		return nil, fmt.Errorf(
			"%w: at most %d allowlist entries are allowed",
			ErrInvalidDatabaseProxy,
			MaxDatabaseProxyAllowlist,
		)
	}

	seen := make(map[string]bool, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		cidr, err := normalizeCIDR(value)
		if err != nil {
			return nil, err
		}
		if seen[cidr] {
			continue
		}
		seen[cidr] = true
		normalized = append(normalized, cidr)
	}

	if len(normalized) == 0 {
		return nil, fmt.Errorf("%w: at least one allowlist CIDR is required", ErrInvalidDatabaseProxy)
	}
	sort.Strings(normalized)

	return normalized, nil
}

func normalizeCIDR(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.ContainsAny(trimmed, "\r\n\t ;") {
		return "", fmt.Errorf("%w: %q is not a valid CIDR", ErrInvalidDatabaseProxy, value)
	}

	if !strings.Contains(trimmed, "/") {
		ip := net.ParseIP(trimmed)
		if ip == nil {
			return "", fmt.Errorf("%w: %q is not a valid CIDR", ErrInvalidDatabaseProxy, value)
		}
		if ip.To4() != nil {
			return ip.String() + "/32", nil
		}
		return ip.String() + "/128", nil
	}

	_, network, err := net.ParseCIDR(trimmed)
	if err != nil {
		return "", fmt.Errorf("%w: %q is not a valid CIDR", ErrInvalidDatabaseProxy, value)
	}

	return network.String(), nil
}

func parseProxyAllowlistLabel(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}

	parts := strings.Split(value, ",")
	allowlist := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			allowlist = append(allowlist, trimmed)
		}
	}

	return allowlist
}

// proxyConfig renders the nginx stream configuration. The listener forwards the
// PostgreSQL protocol untouched, so PostgreSQL keeps terminating TLS itself. The
// `deny all` line is what makes the allowlist fail closed if no entry matches.
func proxyConfig(allowlist []string) string {
	var builder strings.Builder
	builder.WriteString("worker_processes 1;\n")
	builder.WriteString("pid /tmp/nginx.pid;\n")
	builder.WriteString("error_log /dev/stderr warn;\n")
	builder.WriteString("events { worker_connections 256; }\n")
	builder.WriteString("stream {\n")
	builder.WriteString("  resolver 127.0.0.11 valid=10s ipv6=off;\n")
	builder.WriteString("  server {\n")
	builder.WriteString("    listen 5432;\n")
	for _, cidr := range allowlist {
		builder.WriteString("    allow " + cidr + ";\n")
	}
	builder.WriteString("    deny all;\n")
	builder.WriteString("    set $database db:5432;\n")
	builder.WriteString("    proxy_pass $database;\n")
	builder.WriteString("    proxy_connect_timeout 5s;\n")
	builder.WriteString("    proxy_timeout 30m;\n")
	builder.WriteString("  }\n")
	builder.WriteString("}\n")

	return builder.String()
}
