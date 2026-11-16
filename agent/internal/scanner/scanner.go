// Package scanner inspects a built image with Trivy and ClamAV. Scanning is
// advisory: a scanner that cannot run reports that as a finding instead of
// failing the Deployment, so the Platform Admin can see both the risk and the
// fact that a scan was not possible.
package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"stealth/agent/internal/exec"
)

// Scanner names. They match the `scanner` values the Control Plane stores.
const (
	ScannerTrivy  = "trivy"
	ScannerClamAV = "clamav"
)

// Finding is one result from a scanner. Details stays a free-form map because
// Trivy reports different fields for vulnerabilities, secrets, and
// misconfigurations, and the Control Plane stores them as JSON.
type Finding struct {
	Scanner  string
	Severity string
	Title    string
	Details  map[string]any
}

// Scanner runs Trivy and ClamAV against image references on this node.
type Scanner struct {
	workRoot   string
	executor   exec.Executor
	trivyBin   string
	clamBin    string
	extractBin string
}

// New returns a Scanner that stages the exported image filesystem under
// workRoot. The binaries default to the ones on PATH and can be overridden for
// an installation that keeps them elsewhere.
func New(workRoot string, executor exec.Executor) *Scanner {
	return &Scanner{
		workRoot:   workRoot,
		executor:   executor,
		trivyBin:   "trivy",
		clamBin:    "clamscan",
		extractBin: "tar",
	}
}

// SetTrivyBinary overrides the Trivy executable.
func (s *Scanner) SetTrivyBinary(path string) {
	if path != "" {
		s.trivyBin = path
	}
}

// SetClamAVBinary overrides the ClamAV executable.
func (s *Scanner) SetClamAVBinary(path string) {
	if path != "" {
		s.clamBin = path
	}
}

// Scan runs both scanners and returns every finding. A scanner failure becomes an
// informational finding so the Control Plane can show that the image was not
// fully checked.
func (s *Scanner) Scan(ctx context.Context, imageRef string) []Finding {
	findings := s.scanTrivy(ctx, imageRef)
	findings = append(findings, s.scanClamAV(ctx, imageRef)...)

	return findings
}

type trivyReport struct {
	Results []struct {
		Target          string `json:"Target"`
		Class           string `json:"Class"`
		Type            string `json:"Type"`
		Vulnerabilities []struct {
			VulnerabilityID  string `json:"VulnerabilityID"`
			PkgName          string `json:"PkgName"`
			InstalledVersion string `json:"InstalledVersion"`
			FixedVersion     string `json:"FixedVersion"`
			Severity         string `json:"Severity"`
			Title            string `json:"Title"`
			Description      string `json:"Description"`
		} `json:"Vulnerabilities"`
		Secrets []struct {
			RuleID   string `json:"RuleID"`
			Category string `json:"Category"`
			Severity string `json:"Severity"`
			Title    string `json:"Title"`
		} `json:"Secrets"`
		Misconfigurations []struct {
			ID          string `json:"ID"`
			Title       string `json:"Title"`
			Severity    string `json:"Severity"`
			Description string `json:"Description"`
			Message     string `json:"Message"`
		} `json:"Misconfigurations"`
	} `json:"Results"`
}

// scanTrivy runs the three advisory scanners in one pass. Trivy writes JSON to
// standard output and a progress log to standard error, so the output parses
// even while it downloads its database.
func (s *Scanner) scanTrivy(ctx context.Context, imageRef string) []Finding {
	output, err := s.executor.Output(ctx, exec.Options{
		Name: s.trivyBin,
		Args: []string{
			"image", "--quiet", "--format", "json",
			"--scanners", "vuln,secret,misconfig",
			imageRef,
		},
	})
	if err != nil {
		return []Finding{failureFinding(ScannerTrivy, err)}
	}

	var report trivyReport
	if err := json.Unmarshal([]byte(output), &report); err != nil {
		return []Finding{failureFinding(
			ScannerTrivy,
			fmt.Errorf("Trivy output is not valid JSON: %w", err),
		)}
	}

	var findings []Finding
	for _, result := range report.Results {
		for _, vulnerability := range result.Vulnerabilities {
			findings = append(findings, Finding{
				Scanner:  ScannerTrivy,
				Severity: normalizeSeverity(vulnerability.Severity),
				Title: firstNonEmpty(
					vulnerability.Title,
					vulnerability.VulnerabilityID,
					"Vulnerability",
				),
				Details: map[string]any{
					"kind":             "vulnerability",
					"target":           result.Target,
					"vulnerabilityId":  vulnerability.VulnerabilityID,
					"package":          vulnerability.PkgName,
					"installedVersion": vulnerability.InstalledVersion,
					"fixedVersion":     vulnerability.FixedVersion,
					"description":      vulnerability.Description,
				},
			})
		}

		for _, secret := range result.Secrets {
			findings = append(findings, Finding{
				Scanner:  ScannerTrivy,
				Severity: normalizeSeverity(secret.Severity),
				Title:    firstNonEmpty(secret.Title, secret.RuleID, "Secret"),
				Details: map[string]any{
					"kind":     "secret",
					"target":   result.Target,
					"ruleId":   secret.RuleID,
					"category": secret.Category,
				},
			})
		}

		for _, misconfiguration := range result.Misconfigurations {
			findings = append(findings, Finding{
				Scanner:  ScannerTrivy,
				Severity: normalizeSeverity(misconfiguration.Severity),
				Title:    firstNonEmpty(misconfiguration.Title, misconfiguration.ID, "Misconfiguration"),
				Details: map[string]any{
					"kind":        "misconfiguration",
					"target":      result.Target,
					"id":          misconfiguration.ID,
					"description": misconfiguration.Description,
					"message":     misconfiguration.Message,
				},
			})
		}
	}

	return findings
}

// scanClamAV exports the image filesystem to a temporary directory and scans it
// with the host ClamAV. Exporting avoids needing ClamAV inside every user image,
// and the directory is removed whether the scan succeeds or fails.
func (s *Scanner) scanClamAV(ctx context.Context, imageRef string) []Finding {
	if err := os.MkdirAll(s.workRoot, 0o750); err != nil {
		return []Finding{failureFinding(ScannerClamAV, err)}
	}

	dir, err := os.MkdirTemp(s.workRoot, "scan-*")
	if err != nil {
		return []Finding{failureFinding(ScannerClamAV, err)}
	}
	defer os.RemoveAll(dir)

	containerName := "stealth-scan-" + filepath.Base(dir)
	created := false
	defer func() {
		if created {
			_, _ = s.executor.Output(ctx, exec.Options{
				Name: "docker",
				Args: []string{"rm", "--force", containerName},
			})
		}
	}()

	if _, err := s.executor.Output(ctx, exec.Options{
		Name: "docker",
		Args: []string{"create", "--name", containerName, imageRef},
	}); err != nil {
		return []Finding{failureFinding(ScannerClamAV, err)}
	}
	created = true

	archive := filepath.Join(dir, "rootfs.tar")
	if err := s.executor.OutputToFile(ctx, exec.Options{
		Name: "docker",
		Args: []string{"export", containerName},
	}, archive); err != nil {
		return []Finding{failureFinding(ScannerClamAV, err)}
	}

	rootfs := filepath.Join(dir, "rootfs")
	if err := os.MkdirAll(rootfs, 0o750); err != nil {
		return []Finding{failureFinding(ScannerClamAV, err)}
	}
	if _, err := s.executor.Output(ctx, exec.Options{
		Name: s.extractBin,
		Args: []string{"-xf", archive, "-C", rootfs},
	}); err != nil {
		return []Finding{failureFinding(ScannerClamAV, err)}
	}

	// ClamAV exits non-zero when it finds an infected file, so the output is
	// parsed first and the exit status only matters when nothing was found.
	output, scanErr := s.executor.Output(ctx, exec.Options{
		Name: s.clamBin,
		Args: []string{"--recursive", "--infected", "--no-summary", rootfs},
	})

	findings := parseClamAV(output)
	if scanErr != nil && len(findings) == 0 {
		return []Finding{failureFinding(ScannerClamAV, scanErr)}
	}

	return findings
}

// parseClamAV turns `<path>: <signature> FOUND` lines into findings. Malware is
// always reported as high severity: a signature match is a concrete malicious
// file rather than a theoretical weakness.
func parseClamAV(output string) []Finding {
	var findings []Finding
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasSuffix(line, " FOUND") {
			continue
		}

		body := strings.TrimSuffix(line, " FOUND")
		separator := strings.LastIndex(body, ": ")
		if separator < 0 {
			continue
		}

		findings = append(findings, Finding{
			Scanner:  ScannerClamAV,
			Severity: "high",
			Title:    strings.TrimSpace(body[separator+2:]),
			Details: map[string]any{
				"kind": "malware",
				"path": strings.TrimSpace(body[:separator]),
			},
		})
	}

	return findings
}

func failureFinding(scanner string, err error) Finding {
	return Finding{
		Scanner:  scanner,
		Severity: "info",
		Title:    fmt.Sprintf("The %s scan could not run", scanner),
		Details: map[string]any{
			"kind":  "scan_error",
			"error": err.Error(),
		},
	}
}

func normalizeSeverity(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "critical":
		return "critical"
	case "high":
		return "high"
	case "medium":
		return "medium"
	case "low":
		return "low"
	case "info":
		return "info"
	default:
		return "unknown"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}

	return ""
}
