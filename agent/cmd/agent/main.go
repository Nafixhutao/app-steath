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
	"stealth/agent/internal/node"
	"stealth/agent/internal/runtime"
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
	// Caddy runs as a container on this node, so it must join each Project
	// network to resolve the alias a route dials.
	services.SetNetworkAttacher(runtime.NewCaddyAttacher(
		runtime.NewCLIDocker(executor, os.Getenv("AGENT_PROBE_IMAGE")),
		os.Getenv("CADDY_CONTAINER_NAME"),
	))

	// Reconcile before serving so containers that outlived the agent get their
	// network alias and route back. A failure is logged, not fatal: the agent is
	// still useful for Builds, and the next restart retries.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), reconcileTimeout)
		defer cancel()

		if err := services.Reconcile(ctx); err != nil {
			log.Printf("reconcile services: %v", err)
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

	server := &http.Server{
		Addr:              address,
		Handler:           api.NewHandler(token, builds, nodeInfo, services),
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
