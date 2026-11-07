package main

import (
	"log"
	"net/http"
	"os"

	"stealth/agent/internal/api"
)

func main() {
	token := os.Getenv("AGENT_TOKEN")
	if token == "" {
		log.Fatal("AGENT_TOKEN is required")
	}

	address := os.Getenv("AGENT_ADDR")
	if address == "" {
		address = ":8081"
	}

	log.Printf("node agent listening on %s", address)
	if err := http.ListenAndServe(address, api.NewHandler(token)); err != nil {
		log.Fatal(err)
	}
}
