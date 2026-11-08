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
