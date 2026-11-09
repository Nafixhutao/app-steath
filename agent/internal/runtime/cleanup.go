package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Retention limits. They are constants rather than settings because the spec
// fixes them: three images per Service and one Build-cache prune per week.
const (
	// ImageRetention is how many images of one Service survive a cleanup. A
	// rollback needs the previous release, and one spare leaves room for a
	// second attempt, so three is the smallest useful number.
	ImageRetention = 3

	// BuildCacheMaxAge is how old a BuildKit cache entry must be before the
	// weekly prune may drop it. The cache is what makes a repeat Build fast, so
	// it is trimmed by age instead of being wiped.
	BuildCacheMaxAge = 7 * 24 * time.Hour

	// imageRepositoryPrefix is the repository every Service image is built
	// under. The Service id is appended, which is how the cleanup groups images
	// per Service without asking the Control Plane.
	imageRepositoryPrefix = "stealth/service-"
)

// AbortRequest identifies a Deployment whose leftovers must be removed.
type AbortRequest struct {
	DeploymentID string
	ServiceID    string
	// ImageRef is the image the Build produced, when the Control Plane knows it.
	// The agent removes it only when no container uses it.
	ImageRef string
}

// AbortResult reports what a cancel actually cleaned up, so the Control Plane can
// log a truthful outcome instead of assuming the node was left clean.
type AbortResult struct {
	DeploymentID      string
	ServiceID         string
	ContainersRemoved int
	ImageRemoved      bool
}

// CleanupReport summarises one cleanup pass.
type CleanupReport struct {
	ContainersRemoved int
	ImagesRemoved     int
	VolumesRemoved    int
	CachePruned       bool
}

// Abort removes everything a cancelled Deployment left behind. The container
// that is already serving the Service is never touched: the Control Plane only
// cancels a Deployment that has not taken traffic, and this guard keeps that
// promise even if a cancel races a promotion.
func (m *Manager) Abort(ctx context.Context, request AbortRequest) (AbortResult, error) {
	if strings.TrimSpace(request.ServiceID) == "" || strings.TrimSpace(request.DeploymentID) == "" {
		return AbortResult{}, fmt.Errorf("%w: serviceId and deploymentId are required", ErrInvalidDeploy)
	}

	// The Service lock keeps Abort from interleaving with a Deploy that is
	// promoting a candidate right now.
	unlock := m.lockService(request.ServiceID)
	defer unlock()

	result := AbortResult{DeploymentID: request.DeploymentID, ServiceID: request.ServiceID}

	containers, err := m.docker.ListContainers(ctx, map[string]string{
		LabelDeploymentID: request.DeploymentID,
	})
	if err != nil {
		return result, fmt.Errorf("could not list the containers of the Deployment: %w", err)
	}

	servingName := serviceContainerName(request.ServiceID)
	for _, container := range containers {
		// A running container under the stable name has taken traffic, so it is
		// the live Service rather than a leftover.
		if container.Name == servingName && container.Running() {
			continue
		}
		if err := m.docker.RemoveContainer(ctx, container.ID, true); err != nil {
			log.Printf("abort %s: could not remove container %s: %v", request.DeploymentID, container.Name, err)
			continue
		}
		result.ContainersRemoved++
	}

	if request.ImageRef != "" {
		removed, err := m.removeImageIfUnused(ctx, request.ImageRef)
		if err != nil {
			log.Printf("abort %s: could not remove image %s: %v", request.DeploymentID, request.ImageRef, err)
		}
		result.ImageRemoved = removed
	}

	return result, nil
}

// Cleanup runs the node-wide housekeeping pass: it drops containers that were
// never promoted, keeps only the newest images of each Service, and prunes the
// Build cache once a week. It runs when the agent starts, so a node that was
// offline for a while comes back tidy.
func (m *Manager) Cleanup(ctx context.Context) (CleanupReport, error) {
	var report CleanupReport

	containers, err := m.docker.ListContainers(ctx, map[string]string{LabelType: ResourceTypeService})
	if err != nil {
		return report, fmt.Errorf("could not list the Service containers: %w", err)
	}

	for _, container := range containers {
		// A candidate never took traffic and has no owner once its Deploy
		// returned, so it is always safe to drop.
		if !strings.HasSuffix(container.Name, candidateSuffix) {
			continue
		}
		if err := m.docker.RemoveContainer(ctx, container.ID, true); err != nil {
			log.Printf("cleanup: could not remove leftover candidate %s: %v", container.Name, err)
			continue
		}
		report.ContainersRemoved++
	}

	removed, err := m.PruneImages(ctx)
	if err != nil {
		log.Printf("cleanup: could not prune images: %v", err)
	}
	report.ImagesRemoved = removed

	volumesRemoved, err := m.pruneOrphanVolumes(ctx, containers)
	if err != nil {
		log.Printf("cleanup: could not prune Volumes: %v", err)
	}
	report.VolumesRemoved = volumesRemoved

	databaseVolumesRemoved, err := m.pruneOrphanDatabaseVolumes(ctx)
	if err != nil {
		log.Printf("cleanup: could not prune Database Volumes: %v", err)
	}
	report.VolumesRemoved += databaseVolumesRemoved

	pruned, err := m.pruneBuildCacheWeekly(ctx)
	if err != nil {
		log.Printf("cleanup: could not prune the Build cache: %v", err)
	}
	report.CachePruned = pruned

	return report, nil
}

// pruneOrphanVolumes removes a labelled Volume whose Service has no container on
// this node. A stopped Service keeps its container, so its Volume is never
// mistaken for an orphan.
func (m *Manager) pruneOrphanVolumes(ctx context.Context, containers []ContainerInfo) (int, error) {
	live := make(map[string]bool, len(containers))
	for _, container := range containers {
		if serviceID := container.Labels[LabelServiceID]; serviceID != "" {
			live[serviceID] = true
		}
	}

	volumes, err := m.docker.ListVolumes(ctx, map[string]string{LabelType: ResourceTypeVolume})
	if err != nil {
		return 0, err
	}

	removed := 0
	for _, volume := range volumes {
		serviceID := volume.Labels[LabelServiceID]
		if serviceID != "" && live[serviceID] {
			continue
		}
		if _, err := m.docker.RemoveVolume(ctx, volume.Name); err != nil {
			log.Printf("cleanup: could not remove orphan Volume %s: %v", volume.Name, err)
			continue
		}
		removed++
	}

	return removed, nil
}

// PruneImages keeps the newest ImageRetention images of every Service and removes
// the rest. An image still referenced by a container is skipped, so pruning can
// never break a Service that is running or waiting to be started.
func (m *Manager) PruneImages(ctx context.Context) (int, error) {
	images, err := m.docker.ListImages(ctx, imageRepositoryPrefix)
	if err != nil {
		return 0, err
	}

	protected, err := m.containerImages(ctx)
	if err != nil {
		return 0, err
	}

	// Group by repository (the Service), then keep the newest few.
	byRepository := make(map[string][]ImageInfo)
	for _, image := range images {
		repository, _, found := strings.Cut(image.Ref, ":")
		if !found {
			continue
		}
		byRepository[repository] = append(byRepository[repository], image)
	}

	removed := 0
	for _, group := range byRepository {
		// Newest first, so everything after the retention window is a candidate.
		sort.Slice(group, func(i, j int) bool {
			return group[i].CreatedAt.After(group[j].CreatedAt)
		})

		for index, image := range group {
			if index < ImageRetention {
				continue
			}
			if protected[image.Ref] {
				continue
			}
			if err := m.docker.RemoveImage(ctx, image.Ref); err != nil {
				log.Printf("cleanup: could not remove image %s: %v", image.Ref, err)
				continue
			}
			removed++
		}
	}

	return removed, nil
}

// containerImages returns the image references that a container still uses.
func (m *Manager) containerImages(ctx context.Context) (map[string]bool, error) {
	containers, err := m.docker.ListContainers(ctx, nil)
	if err != nil {
		return nil, err
	}

	used := make(map[string]bool, len(containers))
	for _, container := range containers {
		if container.Image != "" {
			used[container.Image] = true
		}
	}

	return used, nil
}

// removeImageIfUnused deletes an image only when nothing references it, which is
// what keeps a cancel from deleting the release that is still serving.
func (m *Manager) removeImageIfUnused(ctx context.Context, imageRef string) (bool, error) {
	used, err := m.containerImages(ctx)
	if err != nil {
		return false, err
	}
	if used[imageRef] {
		return false, nil
	}

	if err := m.docker.RemoveImage(ctx, imageRef); err != nil {
		// The Build may have been cancelled before it tagged anything, which is
		// a success from the caller's point of view.
		return false, nil
	}

	return true, nil
}

// pruneBuildCacheWeekly prunes the Build cache at most once every
// BuildCacheMaxAge. The last run is recorded on disk so an agent restart does not
// prune again, and so a node that keeps restarting still gets pruned weekly.
func (m *Manager) pruneBuildCacheWeekly(ctx context.Context) (bool, error) {
	if m.cleanupStatePath == "" {
		return false, nil
	}

	if last := m.readCachePruneTime(); !last.IsZero() && m.clock().Sub(last) < BuildCacheMaxAge {
		return false, nil
	}

	if err := m.docker.PruneBuildCache(ctx, BuildCacheMaxAge); err != nil {
		return false, err
	}
	m.writeCachePruneTime(m.clock())

	return true, nil
}

type cleanupState struct {
	LastCachePrune time.Time `json:"lastCachePrune"`
}

func (m *Manager) readCachePruneTime() time.Time {
	raw, err := os.ReadFile(m.cleanupStatePath)
	if err != nil {
		return time.Time{}
	}

	var state cleanupState
	if err := json.Unmarshal(raw, &state); err != nil {
		return time.Time{}
	}

	return state.LastCachePrune
}

func (m *Manager) writeCachePruneTime(at time.Time) {
	raw, err := json.Marshal(cleanupState{LastCachePrune: at})
	if err != nil {
		log.Printf("cleanup: could not encode the cleanup state: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(m.cleanupStatePath), 0o750); err != nil {
		log.Printf("cleanup: could not prepare the cleanup state directory: %v", err)
		return
	}
	if err := os.WriteFile(m.cleanupStatePath, raw, 0o600); err != nil {
		log.Printf("cleanup: could not record the Build-cache prune: %v", err)
	}
}
