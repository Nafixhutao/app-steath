package runtime

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// ErrInvalidHostname is returned for a Custom Domain that is not a bare DNS
// name. The Control Plane validates too, but the agent must not program a route
// for anything it cannot serve.
var ErrInvalidHostname = errors.New("invalid hostname")

// ErrServiceNotRunning is returned when a Custom Domain is verified before the
// Service has a running container. The Control Plane leaves the domain pending
// so the owner can deploy and retry.
var ErrServiceNotRunning = errors.New("service not running")

// ServiceHostnameState is the outcome of adding or removing a Custom Domain
// route. A removal reports `routed=false` because no route remains.
type ServiceHostnameState struct {
	ServiceID string
	Hostname  string
	Routed    bool
}

// hostnameLabelPattern is one DNS label: 1-63 characters, no leading or
// trailing hyphen.
var hostnameLabelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

// normalizeHostname lowercases a bare hostname and rejects schemes, ports,
// paths, wildcards and IP literals. It is the same shape the Control Plane
// stores, so a route can never point at a name the platform did not verify.
func normalizeHostname(value string) (string, error) {
	hostname := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(value), "."))
	if hostname == "" ||
		len(hostname) > 253 ||
		strings.Contains(hostname, "://") ||
		strings.ContainsAny(hostname, " \t\r\n/:@*?#") {
		return "", ErrInvalidHostname
	}

	labels := strings.Split(hostname, ".")
	if len(labels) < 2 {
		return "", ErrInvalidHostname
	}
	for _, label := range labels {
		if !hostnameLabelPattern.MatchString(label) {
			return "", ErrInvalidHostname
		}
	}

	return hostname, nil
}

// AddHostname points a verified Custom Domain at the running Service container.
// The route dials the container's current network alias, the same upstream the
// Platform Subdomain uses, so both hostnames reach the same release. Deploy
// re-points the route when a new container takes over.
func (m *Manager) AddHostname(
	ctx context.Context,
	serviceID string,
	hostname string,
) (ServiceHostnameState, error) {
	normalized, err := normalizeHostname(hostname)
	if err != nil {
		return ServiceHostnameState{}, err
	}

	unlock := m.lockService(serviceID)
	defer unlock()

	info, err := m.docker.InspectContainer(ctx, serviceContainerName(serviceID))
	if err != nil {
		return ServiceHostnameState{}, ErrUnknownService
	}
	if !info.Running() {
		return ServiceHostnameState{}, ErrServiceNotRunning
	}

	alias := info.Labels[LabelAlias]
	if alias == "" {
		return ServiceHostnameState{}, fmt.Errorf("container %s has no %s label", info.Name, LabelAlias)
	}
	port, err := containerPortOf(info)
	if err != nil {
		return ServiceHostnameState{}, err
	}

	if err := m.router.PutRoute(ctx, Route{
		Hostname:     normalized,
		Upstream:     upstream(alias, port),
		ServiceID:    serviceID,
		DeploymentID: info.Labels[LabelDeploymentID],
	}); err != nil {
		return ServiceHostnameState{}, err
	}

	return ServiceHostnameState{ServiceID: serviceID, Hostname: normalized, Routed: true}, nil
}

// RemoveHostname withdraws a Custom Domain route. It is idempotent: removing a
// hostname that was never routed succeeds.
func (m *Manager) RemoveHostname(
	ctx context.Context,
	serviceID string,
	hostname string,
) (ServiceHostnameState, error) {
	normalized, err := normalizeHostname(hostname)
	if err != nil {
		return ServiceHostnameState{}, err
	}

	unlock := m.lockService(serviceID)
	defer unlock()

	if err := m.router.DeleteRoute(ctx, normalized); err != nil {
		return ServiceHostnameState{}, err
	}

	return ServiceHostnameState{ServiceID: serviceID, Hostname: normalized, Routed: false}, nil
}
