package main

import (
	"context"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"stealth/agent/internal/api"
	"stealth/agent/internal/build"
	"stealth/agent/internal/exec"
	"stealth/agent/internal/heartbeat"
	"stealth/agent/internal/hostmetrics"
	"stealth/agent/internal/node"
	"stealth/agent/internal/runtime"
	"stealth/agent/internal/scanner"
)

// heartbeatInterval matches the platform spec: the Control Plane treats a node
// as unhealthy after three missed beats.
const heartbeatInterval = 30 * time.Second

// reconcileTimeout bounds the startup pass that rebuilds the node's view from
// container labels, so a hung Docker daemon cannot block the agent from serving.
const reconcileTimeout = 2 * time.Minute

// volumeEnforceInterval is how often the agent checks that no Service Volume has
// grown past its limit.
const volumeEnforceInterval = 1 * time.Minute

func main() {
	token := os.Getenv("AGENT_TOKEN")
	if token == "" {
		log.Fatal("AGENT_TOKEN is required")
	}

	address := os.Getenv("AGENT_ADDR")
	if address == "" {
		address = ":8081"
	}

	name := os.Getenv("AGENT_NAME")
	if name == "" {
		name = "node-1"
	}

	workRoot := os.Getenv("AGENT_WORK_DIR")
	if workRoot == "" {
		workRoot = filepath.Join(os.TempDir(), "stealth-agent")
	}

	caddyAdminURL := os.Getenv("CADDY_ADMIN_URL")
	if caddyAdminURL == "" {
		caddyAdminURL = "http://127.0.0.1:2019"
	}

	executor := exec.SystemExecutor{}
	builds := build.NewManager(filepath.Join(workRoot, "builds"), executor)
	nodeInfo := node.New(name, executor)

	router := runtime.NewCaddyRouter(caddyAdminURL)
	// Caddy asks the Control Plane before it issues a certificate. The endpoint
	// runs inside the Caddy container, so a loopback Control Plane URL is
	// rewritten to the host gateway the container can reach.
	controlPlaneURL := os.Getenv("CONTROL_PLANE_URL")
	if controlPlaneURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		askURL := caddyAskURL(controlPlaneURL, token)
		if err := router.ConfigureOnDemandTLS(ctx, askURL); err != nil {
			log.Printf("caddy on-demand TLS: %v", err)
		}
		cancel()
	}

	services := runtime.NewManager(
		runtime.NewCLIDocker(executor, os.Getenv("AGENT_PROBE_IMAGE")),
		router,
	)
	// The weekly Build-cache prune is recorded here, so a restart does not prune
	// again and a node that keeps restarting still gets pruned every week.
	services.SetCleanupStatePath(filepath.Join(workRoot, "cleanup.json"))
	// Backup artifacts are staged here between creation and the Control Plane's
	// download. The Control Plane removes each file once it is stored.
	services.SetBackupDir(filepath.Join(workRoot, "backups"))
	// A Restore artifact is staged here while it is loaded into a Database or
	// Volume. The agent removes each file when the Restore finishes.
	services.SetRestoreDir(filepath.Join(workRoot, "restores"))
	// Every Project Database is a schema inside a shared engine server, so the
	// agent provisions and drops tenants through each server's admin account.
	services.SetDatabaseServerPasswords(
		os.Getenv("MYSQL_ROOT_PASSWORD"),
		os.Getenv("PGDB_POSTGRES_PASSWORD"),
	)
	// The shared MinIO server's admin credentials are used only by the agent to
	// provision tenant buckets and IAM users. mc config and temporary bucket
	// policies stay under the work root; neither the credentials nor the tenant
	// secret keys are ever logged.
	services.SetStorageDir(filepath.Join(workRoot, "storage"))
	services.SetStorageCredentials(
		os.Getenv("MINIO_ROOT_USER"),
		os.Getenv("MINIO_ROOT_PASSWORD"),
	)
	if domain := strings.TrimSpace(os.Getenv("PLATFORM_DOMAIN")); domain != "" {
		services.SetStorageHostname("s3." + domain)
	}
	// Caddy runs as a container on this node, so it must join each Project
	// network to resolve the alias a route dials.
	services.SetNetworkAttacher(runtime.NewCaddyAttacher(
		runtime.NewCLIDocker(executor, os.Getenv("AGENT_PROBE_IMAGE")),
		os.Getenv("CADDY_CONTAINER_NAME"),
	))
	// The phpMyAdmin host also carries the dashboard's automatic sign-in bridge,
	// which proxies to the Control Plane. Without the address no bridge route is
	// programmed, so "Open phpMyAdmin" stays a plain link.
	if controlPlaneURL != "" {
		services.SetPhpMyAdminUpstream(controlPlaneUpstream(controlPlaneURL))
	}

	// Scans run after a Deployment and stage the exported image filesystem under
	// the work root. Trivy and ClamAV are host binaries; an installation that
	// keeps them elsewhere points these variables at them.
	scans := scanner.New(filepath.Join(workRoot, "scans"), executor)
	scans.SetTrivyBinary(os.Getenv("TRIVY_BIN"))
	scans.SetClamAVBinary(os.Getenv("CLAMSCAN_BIN"))

	// Reconcile before serving so containers that outlived the agent get their
	// network alias and route back. A failure is logged, not fatal: the agent is
	// still useful for Builds, and the next restart retries.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), reconcileTimeout)
		defer cancel()

		if err := services.Reconcile(ctx); err != nil {
			log.Printf("reconcile services: %v", err)
		}

		// The public S3 host has no container of its own, so Reconcile's stale
		// route sweep cannot re-install it. Programming it after the sweep keeps
		// it in Caddy across restarts; a MinIO that is still starting is fine
		// because Caddy can hold a route to an upstream that comes up later.
		if err := services.EnsureStorageRoute(ctx); err != nil {
			log.Printf("reconcile storage route: %v", err)
		}

		// Housekeeping runs after Reconcile so it sees the containers the agent
		// just adopted instead of deleting them as leftovers.
		report, err := services.Cleanup(ctx)
		if err != nil {
			log.Printf("cleanup: %v", err)
			return
		}
		log.Printf(
			"cleanup: removed %d containers, %d images and %d volumes, cache pruned: %t",
			report.ContainersRemoved,
			report.ImagesRemoved,
			report.VolumesRemoved,
			report.CachePruned,
		)
	}()

	// Docker cannot quota a Volume on the local driver, so the agent measures the
	// Volumes of running Services and stops a container that grew past its limit.
	go func() {
		ticker := time.NewTicker(volumeEnforceInterval)
		defer ticker.Stop()

		for range ticker.C {
			ctx, cancel := context.WithTimeout(context.Background(), reconcileTimeout)
			stopped, err := services.EnforceVolumes(ctx)
			if err == nil {
				databasesStopped, databaseErr := services.EnforceDatabases(ctx)
				if databaseErr != nil {
					log.Printf("database enforcement: %v", databaseErr)
				} else if databasesStopped > 0 {
					log.Printf("database enforcement: stopped %d over-quota Database(s)", databasesStopped)
				}
			}
			cancel()
			if err != nil {
				log.Printf("volume enforcement: %v", err)
				continue
			}
			if stopped > 0 {
				log.Printf("volume enforcement: stopped %d over-quota container(s)", stopped)
			}
		}
	}()

	// The heartbeat is optional so the agent can be run and tested on its own.
	if controlPlaneURL != "" {
		sender := heartbeat.New(
			controlPlaneURL+"/api/nodes/heartbeat",
			token,
			heartbeatInterval,
			nodeInfo,
		)
		go sender.Run(context.Background())
	}

	// Host metrics sample the node itself every 5 seconds and keep an hour of
	// in-memory history. The disk metric targets the work root, so it reports
	// the filesystem that actually holds Builds, Volumes, and Backups.
	hostMetrics := hostmetrics.New(5*time.Second, 720, workRoot)
	go hostMetrics.Start(context.Background())

	server := &http.Server{
		Addr:              address,
		Handler:           api.NewHandler(token, builds, nodeInfo, services, scans, hostMetrics),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("node agent listening on %s", address)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// caddyAskURL builds the on-demand TLS permission endpoint. Caddy runs in its
// own container, so a loopback Control Plane host is rewritten to the Docker
// host gateway: `localhost` inside that container would be Caddy itself.
func caddyAskURL(controlPlane string, token string) string {
	base := strings.TrimRight(controlPlane, "/")
	if parsed, err := url.Parse(base); err == nil {
		switch parsed.Hostname() {
		case "localhost", "127.0.0.1", "::1":
			port := parsed.Port()
			parsed.Host = "host.docker.internal"
			if port != "" {
				parsed.Host += ":" + port
			}
			base = strings.TrimRight(parsed.String(), "/")
		}
	}

	return base + "/api/internal/caddy/ask?token=" + url.QueryEscape(token)
}

// controlPlaneUpstream is the `host:port` Caddy dials for the phpMyAdmin sign-in
// bridge. Caddy answers a loopback address differently from the Node Agent, so the
// host gateway is used for a local Control Plane just as it is for the ask URL.
func controlPlaneUpstream(controlPlane string) string {
	base := strings.TrimRight(controlPlane, "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" {
		return ""
	}

	host := parsed.Hostname()
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		host = "host.docker.internal"
	}
	port := parsed.Port()
	if port == "" {
		switch parsed.Scheme {
		case "https":
			port = "443"
		default:
			port = "80"
		}
	}

	return host + ":" + port
}
