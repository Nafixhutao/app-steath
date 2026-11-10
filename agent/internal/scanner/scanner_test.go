package scanner

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"stealth/agent/internal/exec"
)

// fakeExecutor answers commands by name so a test can describe the output of
// Trivy and ClamAV without either binary or Docker being installed.
type fakeExecutor struct {
	mu      sync.Mutex
	outputs map[string]func() (string, error)
	calls   []exec.Options
}

func (f *fakeExecutor) record(options exec.Options) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, options)
}

func (f *fakeExecutor) Stream(ctx context.Context, options exec.Options, onLine func(string)) error {
	f.record(options)
	return nil
}

func (f *fakeExecutor) Output(ctx context.Context, options exec.Options) (string, error) {
	f.record(options)
	if run, ok := f.outputs[options.Name]; ok {
		return run()
	}

	return "", nil
}

func (f *fakeExecutor) OutputToFile(ctx context.Context, options exec.Options, path string) error {
	f.record(options)

	return os.WriteFile(path, []byte("rootfs"), 0o600)
}

func (f *fakeExecutor) RunFile(ctx context.Context, options exec.Options, path string) error {
	f.record(options)
	return nil
}

const trivyJSON = `{
  "Results": [
    {
      "Target": "app (alpine 3.19)",
      "Class": "os-pkgs",
      "Type": "alpine",
      "Vulnerabilities": [
        {
          "VulnerabilityID": "CVE-2024-0001",
          "PkgName": "libssl",
          "InstalledVersion": "3.1.0",
          "FixedVersion": "3.1.4",
          "Severity": "CRITICAL",
          "Title": "OpenSSL certificate verification bypass",
          "Description": "A crafted certificate is accepted."
        }
      ],
      "Secrets": [
        {
          "RuleID": "generic-api-key",
          "Category": "Secret",
          "Severity": "HIGH",
          "Title": "Generic API Key"
        }
      ],
      "Misconfigurations": [
        {
          "ID": "DS002",
          "Title": "Image user should not be root",
          "Severity": "MEDIUM",
          "Description": "Running as root weakens the container boundary.",
          "Message": "Specify a non-root user."
        }
      ]
    }
  ]
}`

func TestScanReportsTrivyVulnerabilitiesSecretsAndMisconfigurations(t *testing.T) {
	executor := &fakeExecutor{outputs: map[string]func() (string, error){
		"trivy": func() (string, error) { return trivyJSON, nil },
	}}
	s := New(t.TempDir(), executor)

	findings := s.Scan(context.Background(), "stealth/service:deployment-1")

	if len(findings) != 3 {
		t.Fatalf("expected three findings, got %d: %+v", len(findings), findings)
	}
	if findings[0].Scanner != ScannerTrivy || findings[0].Severity != "critical" {
		t.Fatalf("unexpected vulnerability finding: %+v", findings[0])
	}
	if findings[0].Title != "OpenSSL certificate verification bypass" {
		t.Fatalf("unexpected vulnerability title: %q", findings[0].Title)
	}
	if findings[0].Details["package"] != "libssl" ||
		findings[0].Details["vulnerabilityId"] != "CVE-2024-0001" {
		t.Fatalf("unexpected vulnerability details: %+v", findings[0].Details)
	}

	if findings[1].Details["kind"] != "secret" || findings[1].Severity != "high" {
		t.Fatalf("unexpected secret finding: %+v", findings[1])
	}
	if findings[2].Details["kind"] != "misconfiguration" || findings[2].Severity != "medium" {
		t.Fatalf("unexpected misconfiguration finding: %+v", findings[2])
	}

	// The Trivy command asks for all three scanners in one pass.
	var trivyArgs []string
	for _, call := range executor.calls {
		if call.Name == "trivy" {
			trivyArgs = call.Args
		}
	}
	if !contains(trivyArgs, "vuln,secret,misconfig") {
		t.Fatalf("Trivy was not asked for every scanner: %+v", trivyArgs)
	}
}

func TestScanReportsMalwareAsHighSeverity(t *testing.T) {
	executor := &fakeExecutor{outputs: map[string]func() (string, error){
		"trivy": func() (string, error) { return `{"Results":[]}`, nil },
		"clamscan": func() (string, error) {
			// ClamAV exits non-zero when it finds an infected file.
			return "/rootfs/usr/bin/tool: Unix.Trojan.Test-1 FOUND\n", errors.New("exit status 1")
		},
	}}
	s := New(t.TempDir(), executor)

	findings := s.Scan(context.Background(), "stealth/service:deployment-1")

	if len(findings) != 1 {
		t.Fatalf("expected one malware finding, got %+v", findings)
	}
	if findings[0].Scanner != ScannerClamAV || findings[0].Severity != "high" {
		t.Fatalf("unexpected malware finding: %+v", findings[0])
	}
	if findings[0].Title != "Unix.Trojan.Test-1" {
		t.Fatalf("unexpected signature: %q", findings[0].Title)
	}
	if findings[0].Details["path"] != "/rootfs/usr/bin/tool" {
		t.Fatalf("unexpected malware path: %+v", findings[0].Details)
	}
}

func TestScanReportsAScannerThatCannotRun(t *testing.T) {
	executor := &fakeExecutor{outputs: map[string]func() (string, error){
		"trivy":    func() (string, error) { return "", errors.New("exec: trivy: not found") },
		"clamscan": func() (string, error) { return "", errors.New("exec: clamscan: not found") },
	}}
	s := New(t.TempDir(), executor)

	findings := s.Scan(context.Background(), "stealth/service:deployment-1")

	if len(findings) != 2 {
		t.Fatalf("expected one finding per scanner, got %+v", findings)
	}
	for _, finding := range findings {
		if finding.Severity != "info" || finding.Details["kind"] != "scan_error" {
			t.Fatalf("a scanner failure must be an informational finding: %+v", finding)
		}
		if !strings.Contains(finding.Details["error"].(string), "not found") {
			t.Fatalf("the finding must carry the reason: %+v", finding)
		}
	}
}

func TestScanReportsNothingForACleanImage(t *testing.T) {
	executor := &fakeExecutor{outputs: map[string]func() (string, error){
		"trivy":    func() (string, error) { return `{"Results":[]}`, nil },
		"clamscan": func() (string, error) { return "", nil },
	}}
	s := New(t.TempDir(), executor)

	if findings := s.Scan(context.Background(), "stealth/service:deployment-1"); len(findings) != 0 {
		t.Fatalf("expected no findings, got %+v", findings)
	}
}

func TestScanRejectsUnparsableTrivyOutput(t *testing.T) {
	executor := &fakeExecutor{outputs: map[string]func() (string, error){
		"trivy": func() (string, error) { return "not json", nil },
	}}
	s := New(t.TempDir(), executor)

	findings := s.Scan(context.Background(), "stealth/service:deployment-1")
	if len(findings) == 0 || findings[0].Details["kind"] != "scan_error" {
		t.Fatalf("expected a scan_error finding, got %+v", findings)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}

	return false
}
