package hostmetrics

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestParseCPU(t *testing.T) {
	stat := `cpu  100 0 200 700 100 0 0 0 0 0
cpu0 50 0 100 350 50 0 0 0 0 0
intr 123
`
	busy, idle := parseCPU(strings.NewReader(stat))

	// idle = 700 + 100 (iowait); busy = user + nice + system + the rest.
	if idle != 800 {
		t.Fatalf("idle = %d, want 800", idle)
	}
	if busy != 300 {
		t.Fatalf("busy = %d, want 300", busy)
	}
}

func TestParseCPUShortLine(t *testing.T) {
	if busy, idle := parseCPU(strings.NewReader("cpu 1 2\n")); busy != 0 || idle != 0 {
		t.Fatalf("short cpu line should be rejected, got busy %d idle %d", busy, idle)
	}
}

func TestParseMem(t *testing.T) {
	mem := `MemTotal:        4000000 kB
MemFree:         1000000 kB
MemAvailable:    2000000 kB
Buffers:          200000 kB
`
	used, total := parseMem(strings.NewReader(mem))

	if total != 4000000/1024 {
		t.Fatalf("total = %d, want %d", total, 4000000/1024)
	}
	// used = MemTotal - MemAvailable.
	if used != 2000000/1024 {
		t.Fatalf("used = %d, want %d", used, 2000000/1024)
	}
}

func TestParseMemWithoutAvailable(t *testing.T) {
	mem := `MemTotal:        4000000 kB
MemFree:         1000000 kB
`
	used, total := parseMem(strings.NewReader(mem))

	if total != 4000000/1024 {
		t.Fatalf("total = %d, want %d", total, 4000000/1024)
	}
	// Without MemAvailable the collector falls back to MemFree.
	if used != 3000000/1024 {
		t.Fatalf("used = %d, want %d", used, 3000000/1024)
	}
}

func TestCollectorRecordsHistory(t *testing.T) {
	collector := New(time.Second, 2, "/")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		collector.Start(ctx)
		close(done)
	}()

	// The first sample is taken inside Start, so the test polls briefly until
	// it lands instead of assuming the goroutine has run.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if len(collector.Snapshot().History) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected an initial sample within 2s, got none")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
}

func TestSampleTimestampsAreUTC(t *testing.T) {
	collector := New(time.Second, 5, "/")
	collector.sampleOnce()

	snapshot := collector.Snapshot()
	if snapshot.Current.Timestamp.Location() != time.UTC {
		t.Fatalf("timestamp %v is not UTC", snapshot.Current.Timestamp)
	}
	if time.Since(snapshot.Current.Timestamp) > time.Minute {
		t.Fatalf("timestamp %v is stale", snapshot.Current.Timestamp)
	}
}
