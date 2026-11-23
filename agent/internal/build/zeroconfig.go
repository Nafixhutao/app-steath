package build

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// zeroConfigDockerfile is a Dockerfile the Agent synthesizes for a repository
// that does not ship one, the way Vercel builds a project without configuration.
// ContextDir is the directory the image is built from; for a repository that
// keeps its app in a subfolder (a template gallery, a monorepo) it is that
// subfolder rather than the repository root.
type zeroConfigDockerfile struct {
	Framework  string
	Contents   string
	ContextDir string
}

// detectZeroConfig inspects a checked out repository and returns a generated
// Dockerfile for the framework it recognizes. The bool is false when nothing
// familiar was found, so the caller can report a useful error instead of
// guessing.
func detectZeroConfig(repoRoot string, containerPort int) (zeroConfigDockerfile, bool, error) {
	root, err := sourceRoot(repoRoot)
	if err != nil {
		return zeroConfigDockerfile{}, false, err
	}
	if root == "" {
		return zeroConfigDockerfile{}, false, nil
	}

	port := containerPort
	if port < 1 || port > 65535 {
		port = 3000
	}

	if node, ok, nodeErr := detectNode(root, port); ok || nodeErr != nil {
		return node, ok, nodeErr
	}

	if isFile(filepath.Join(root, "index.html")) {
		return zeroConfigDockerfile{
			Framework:  "static site",
			Contents:   staticDockerfile(port),
			ContextDir: root,
		}, true, nil
	}

	return zeroConfigDockerfile{}, false, nil
}

// sourceRoot picks the directory a zero-config build should use: the repository
// root when it holds the app, the one subfolder that does when the repository is
// a collection of projects, or an error when several subfolders qualify and the
// choice cannot be made safely.
func sourceRoot(repoRoot string) (string, error) {
	if isFile(filepath.Join(repoRoot, "package.json")) || isFile(filepath.Join(repoRoot, "index.html")) {
		return repoRoot, nil
	}

	entries, err := os.ReadDir(repoRoot)
	if err != nil {
		return "", fmt.Errorf("could not read the repository: %w", err)
	}

	var candidates []string
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || entry.Name() == "node_modules" {
			continue
		}
		dir := filepath.Join(repoRoot, entry.Name())
		if isFile(filepath.Join(dir, "package.json")) || isFile(filepath.Join(dir, "index.html")) {
			candidates = append(candidates, entry.Name())
		}
	}
	sort.Strings(candidates)

	switch len(candidates) {
	case 0:
		return "", nil
	case 1:
		return filepath.Join(repoRoot, candidates[0]), nil
	default:
		return "", fmt.Errorf(
			"no Dockerfile was found and the repository holds several projects (%s); "+
				"point the repository URL at one of them with /tree/<branch>/<folder> or add a Dockerfile",
			strings.Join(candidates, ", "),
		)
	}
}

// detectNode recognizes a Node application from its package.json. It returns ok
// false when the directory is not a Node project, so the caller can try the next
// detection rule.
func detectNode(dir string, port int) (zeroConfigDockerfile, bool, error) {
	packagePath := filepath.Join(dir, "package.json")
	if !isFile(packagePath) {
		return zeroConfigDockerfile{}, false, nil
	}

	raw, err := os.ReadFile(packagePath)
	if err != nil {
		return zeroConfigDockerfile{}, false, fmt.Errorf("could not read package.json: %w", err)
	}

	var manifest struct {
		Scripts         map[string]string `json:"scripts"`
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return zeroConfigDockerfile{}, false, fmt.Errorf("package.json is not valid JSON: %w", err)
	}

	portText := strconv.Itoa(port)
	if isNextProject(dir, manifest.Dependencies, manifest.DevDependencies) {
		return zeroConfigDockerfile{
			Framework:  "Next.js",
			Contents:   nodeDockerfile(portText, `["npx", "next", "start", "-p", "`+portText+`"]`),
			ContextDir: dir,
		}, true, nil
	}

	if _, ok := manifest.Scripts["start"]; ok {
		return zeroConfigDockerfile{
			Framework:  "Node.js",
			Contents:   nodeDockerfile(portText, `["npm", "start"]`),
			ContextDir: dir,
		}, true, nil
	}

	if isFile(filepath.Join(dir, "index.html")) {
		// A package.json without a start script that still serves static files;
		// the static rule below handles it.
		return zeroConfigDockerfile{}, false, nil
	}

	return zeroConfigDockerfile{}, false, fmt.Errorf(
		"no Dockerfile was found and package.json has no start script; add a Dockerfile or a start script",
	)
}

func isNextProject(dir string, dependencies, devDependencies map[string]string) bool {
	if _, ok := dependencies["next"]; ok {
		return true
	}
	if _, ok := devDependencies["next"]; ok {
		return true
	}
	for _, name := range []string{"next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"} {
		if isFile(filepath.Join(dir, name)) {
			return true
		}
	}
	return false
}

// staticDockerfile serves the checked out files with BusyBox httpd. The first
// stage exists to drop .git and other sources that must never be downloadable;
// httpd itself writes nothing, so the container runs with a read-only root.
func staticDockerfile(port int) string {
	portText := strconv.Itoa(port)
	return strings.Join([]string{
		"# Generated by Stealth: the repository has no Dockerfile.",
		"FROM alpine:3.20 AS source",
		"WORKDIR /src",
		"COPY . /src",
		"RUN rm -rf /src/.git",
		"",
		"FROM busybox:1.36",
		"COPY --from=source /src /www",
		"EXPOSE " + portText,
		`CMD ["httpd", "-f", "-p", "` + portText + `", "-h", "/www"]`,
		"",
	}, "\n")
}

func nodeDockerfile(portText, command string) string {
	return strings.Join([]string{
		"# Generated by Stealth: the repository has no Dockerfile.",
		"FROM node:24-alpine",
		"WORKDIR /app",
		"ENV NODE_ENV=production",
		"ENV PORT=" + portText,
		"COPY . .",
		"RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi",
		"RUN npm run build --if-present",
		"EXPOSE " + portText,
		"CMD " + command,
		"",
	}, "\n")
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
