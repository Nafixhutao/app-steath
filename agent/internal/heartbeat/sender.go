// Package heartbeat periodically tells the Control Plane that this node is
// alive and what it can do. The Control Plane blocks new Deployments while no
// heartbeat has arrived recently, so this loop is what keeps Deployments
// allowed.
package heartbeat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"stealth/agent/internal/api"
)

// NodeInfoProvider is the subset of the node inspector the heartbeat needs.
type NodeInfoProvider interface {
	NodeInfo() api.NodeInfo
}

// Sender posts heartbeats to the Control Plane.
type Sender struct {
	url      string
	token    string
	interval time.Duration
	info     NodeInfoProvider
	client   *http.Client
}

// New returns a Sender that posts to url every interval.
func New(url, token string, interval time.Duration, info NodeInfoProvider) *Sender {
	return &Sender{
		url:      url,
		token:    token,
		interval: interval,
		info:     info,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Run sends one heartbeat immediately and then on every interval until the
// context is cancelled. A failed heartbeat is logged and retried on the next
// tick rather than stopping the loop, so a Control Plane restart heals itself.
func (s *Sender) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		if err := s.send(ctx); err != nil {
			log.Printf("heartbeat failed: %v", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Sender) send(ctx context.Context) error {
	payload, err := json.Marshal(map[string]any{
		"capacity": s.info.NodeInfo(),
	})
	if err != nil {
		return fmt.Errorf("encode heartbeat: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build heartbeat request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+s.token)

	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("send heartbeat: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return fmt.Errorf("heartbeat rejected with %d: %s", response.StatusCode, body)
	}

	return nil
}
