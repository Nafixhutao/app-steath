# hello-docker fixture

Deterministic Dockerfile fixture for Build and Deploy tests. It serves a single
HTML page from BusyBox `httpd` on port 3000, so a successful build proves the
agent can build an image from a Dockerfile and the container answers HTTP.

Build tests copy this directory into a throwaway Git repository (the Build
pipeline clones a repository URL) rather than relying on this directory being a
nested Git repository.

```
docker build -t stealth-fixture-hello .
docker run --rm -p 3000:3000 stealth-fixture-hello
```
