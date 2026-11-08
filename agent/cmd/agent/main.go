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
	"stealth/agent/internal/heartbeat"
	"stealth/agent/internal/node"
)

// heartbeatInterval matches the platform spec: the Control Plane treats a node
// as unhealthy after three missed beats.
const heartbeatInterval = 30 * time.Second

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

	executor := build.SystemExecutor{}
	builds := build.NewManager(filepath.Join(workRoot, "builds"), executor)
	nodeInfo := node.New(name, executor)

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
		Handler:           api.NewHandler(token, builds, nodeInfo),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("node agent listening on %s", address)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
