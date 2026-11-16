// Package hostmetrics samples the node's own resource usage directly from the
// kernel. It is a lightweight, dependency-free source for the Platform Admin's
// host metrics dashboard: CPU from /proc/stat, memory from /proc/meminfo, and
// storage from statfs. A small in-memory ring buffer backs the history charts,
// so history is lost on restart and only lives as long as the agent process.
package hostmetrics

import (
	"bufio"
	"context"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	procStat = "/proc/stat"
	procMem  = "/proc/meminfo"
)

// Sample is one observation of the host. Memory and storage are reported in MiB
// to match the rest of the Agent contract, which measures Docker stats and
// Volumes in whole MiB.
type Sample struct {
	Timestamp      time.Time `json:"capturedAt"`
	CPUPercent     float64   `json:"cpuPercent"`
	MemoryUsedMB   int64     `json:"memoryUsedMb"`
	MemoryTotalMB  int64     `json:"memoryTotalMb"`
	StorageUsedMB  int64     `json:"storageUsedMb"`
	StorageTotalMB int64     `json:"storageTotalMb"`
}

// Snapshot is the latest sample plus bounded recent history for charts.
type Snapshot struct {
	Current Sample   `json:"current"`
	History []Sample `json:"history"`
}

// Collector samples host metrics on an interval and retains a bounded history.
type Collector struct {
	mu       sync.Mutex
	history  []Sample
	max      int
	interval time.Duration
	diskPath string

	prevBusy, prevIdle uint64
	prevAt             time.Time
	havePrev           bool
}

// New builds a Collector. interval controls the sampling cadence, maxHistory
// the retained sample count, and diskPath the filesystem whose usage is
// reported. The disk path defaults to the agent's work root so the reported
// storage is the volume that actually holds Builds, Volumes, and Backups.
func New(interval time.Duration, maxHistory int, diskPath string) *Collector {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	if maxHistory <= 0 {
		maxHistory = 60
	}
	if strings.TrimSpace(diskPath) == "" {
		diskPath = "/"
	}

	return &Collector{max: maxHistory, interval: interval, diskPath: diskPath}
}

// Start samples immediately and then on the configured interval until ctx ends.
// It is meant to run as a background goroutine for the life of the agent.
func (c *Collector) Start(ctx context.Context) {
	c.sampleOnce()

	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.sampleOnce()
		}
	}
}

// Snapshot returns the latest sample and a copy of the retained history. Before
// the first sample completes it returns an empty snapshot rather than blocking.
func (c *Collector) Snapshot() Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()

	history := make([]Sample, len(c.history))
	copy(history, c.history)

	snapshot := Snapshot{History: history}
	if len(history) > 0 {
		snapshot.Current = history[len(history)-1]
	}

	return snapshot
}

func (c *Collector) sampleOnce() {
	now := time.Now().UTC()
	busy, idle := readCPU()

	sample := Sample{Timestamp: now}
	sample.MemoryUsedMB, sample.MemoryTotalMB = readMem()
	sample.StorageUsedMB, sample.StorageTotalMB = readDisk(c.diskPath)

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.havePrev {
		elapsed := now.Sub(c.prevAt).Seconds()
		if elapsed > 0 {
			totalDelta := (busy + idle) - (c.prevBusy + c.prevIdle)
			busyDelta := busy - c.prevBusy
			if totalDelta > 0 {
				sample.CPUPercent = round2(float64(busyDelta) / float64(totalDelta) * 100)
			}
		}
	}
	c.prevBusy, c.prevIdle, c.prevAt = busy, idle, now
	c.havePrev = true

	c.history = append(c.history, sample)
	if len(c.history) > c.max {
		c.history = c.history[len(c.history)-c.max:]
	}
}

func readCPU() (busy, idle uint64) {
	file, err := os.Open(procStat)
	if err != nil {
		return 0, 0
	}
	defer file.Close()

	return parseCPU(file)
}

// parseCPU sums the aggregate "cpu" line into busy and idle jiffies. Idle
// includes iowait, so a busy wait on disk I/O is not reported as CPU pressure.
func parseCPU(r io.Reader) (busy, idle uint64) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var values []uint64
		for _, field := range fields[1:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				return 0, 0
			}
			values = append(values, value)
		}
		// user nice system idle iowait irq softirq steal guest ...
		idle = values[3]
		if len(values) > 4 {
			idle += values[4]
		}
		for index, value := range values {
			if index == 3 || index == 4 {
				continue
			}
			busy += value
		}
		return busy, idle
	}
	return 0, 0
}

func readMem() (used, total int64) {
	file, err := os.Open(procMem)
	if err != nil {
		return 0, 0
	}
	defer file.Close()

	return parseMem(file)
}

// parseMem returns used = MemTotal - MemAvailable (kB → MiB). When the kernel
// omits MemAvailable, MemFree is used as the fallback.
func parseMem(r io.Reader) (used, total int64) {
	var totalKB, availableKB, freeKB uint64
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB = value
		case "MemAvailable:":
			availableKB = value
		case "MemFree:":
			freeKB = value
		}
	}
	if totalKB == 0 {
		return 0, 0
	}
	available := availableKB
	if available == 0 {
		available = freeKB
	}
	usedKB := uint64(0)
	if totalKB > available {
		usedKB = totalKB - available
	}
	return int64(usedKB / 1024), int64(totalKB / 1024)
}

func readDisk(path string) (used, total int64) {
	var stat syscallStatfs
	if err := statfsCall(path, &stat); err != nil {
		return 0, 0
	}
	blockSize := int64(stat.Bsize)
	total = int64(stat.Blocks) * blockSize
	free := int64(stat.Bavail) * blockSize
	if total > free {
		used = total - free
	}
	return used / (1024 * 1024), total / (1024 * 1024)
}

func round2(value float64) float64 {
	return float64(int64(value*100+0.5)) / 100
}
