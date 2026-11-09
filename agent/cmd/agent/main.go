package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
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

	services := runtime.NewManager(
		runtime.NewCLIDocker(executor, os.Getenv("AGENT_PROBE_IMAGE")),
		runtime.NewCaddyRouter(caddyAdminURL),
	)
	// The weekly Build-cache prune is recorded here, so a restart does not prune
	// again and a node that keeps restarting still gets pruned every week.
	services.SetCleanupStatePath(filepath.Join(workRoot, "cleanup.json"))
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
	if controlPlane := os.Getenv("CONTROL_PLANE_URL"); controlPlane != "" {
		sender := heartbeat.New(
			controlPlane+"/api/nodes/heartbeat",
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
