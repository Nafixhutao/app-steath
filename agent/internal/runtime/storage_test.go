package runtime

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	storageTestBucket    = "sb-0123456789abcdef01234567"
	storageTestSecretKey = "SUPERSECRETKEY123"
	storageTestRootPass  = "ROOTPASSWORD123"
)

// storageRouterStub records the route the Manager programs for the public S3 host.
type storageRouterStub struct{ route Route }

func (r *storageRouterStub) PutRoute(_ context.Context, route Route) error {
	r.route = route
	return nil
}

func (*storageRouterStub) DeleteRoute(context.Context, string) error { return nil }

func (*storageRouterStub) ListRoutes(context.Context) ([]Route, error) { return nil, nil }

// writeFakeMC installs an mc stand-in that records its arguments and answers the
// read-only commands the Storage operations use. It never needs Docker.
func writeFakeMC(t *testing.T, workDir string, extra string) (string, string) {
	t.Helper()

	logPath := filepath.Join(workDir, "mc-args.log")
	scriptPath := filepath.Join(workDir, "mc-fake")
	script := fmt.Sprintf(`#!/bin/sh
args="$*"
printf '%%s\n' "$args" >> %q
_=$(cat)
case "$args" in
  *"--json du"*) printf '{"prefix":"x","size":2097152,"objects":1}\n' ;;
  *"--json anonymous get"*) printf '{"Effect":"Allow","Action":["s3:GetObject"]}\n' ;;
  *"--json admin user list"*) printf '{"accessKey":"tenant-access","policyName":"%s-policy"}\n' ;;
esac
%s
exit 0
`, logPath, storageTestBucket, extra)
	if err := os.WriteFile(scriptPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}

	t.Setenv("MC_BIN", scriptPath)
	return scriptPath, logPath
}

func newStorageManager(t *testing.T) (*Manager, *storageRouterStub) {
	t.Helper()

	router := &storageRouterStub{}
	manager := NewManager(nil, router)
	manager.SetStorageDir(t.TempDir())
	manager.SetStorageCredentials("minio-root", storageTestRootPass)
	manager.SetStorageHostname("s3.example.com")

	return manager, router
}

func TestStorageProvisionGetRemove(t *testing.T) {
	manager, router := newStorageManager(t)
	_, logPath := writeFakeMC(t, manager.storageConfigDir(), "")

	ctx := context.Background()
	if err := manager.EnsureStorageRoute(ctx); err != nil {
		t.Fatal(err)
	}
	if router.route.Hostname != "s3.example.com" || router.route.Upstream != "minio:9000" {
		t.Fatalf("unexpected S3 route: %+v", router.route)
	}

	state, err := manager.ProvisionStorageBucket(ctx, StorageBucketRequest{
		BucketName: storageTestBucket,
		AccessKey:  "tenant-access",
		SecretKey:  storageTestSecretKey,
		Public:     true,
		QuotaMB:    256,
	})
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != storageStatusReady || !state.Healthy || !state.Public || state.QuotaMB != 256 {
		t.Fatalf("unexpected provision state: %+v", state)
	}

	state, err = manager.GetStorageBucket(ctx, storageTestBucket, 256)
	if err != nil {
		t.Fatal(err)
	}
	if state.UsageMB != 2 || !state.Healthy || !state.Public {
		t.Fatalf("unexpected bucket state: %+v", state)
	}

	removal, err := manager.RemoveStorageBucket(ctx, storageTestBucket)
	if err != nil {
		t.Fatal(err)
	}
	if !removal.Removed || removal.BucketID != storageTestBucket {
		t.Fatalf("unexpected removal: %+v", removal)
	}

	args, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	logged := string(args)
	for _, secret := range []string{storageTestSecretKey, storageTestRootPass} {
		if strings.Contains(logged, secret) {
			t.Fatalf("mc arguments leaked a secret: %s", logged)
		}
	}
	for _, command := range []string{"alias set", "mb --ignore-existing", "quota set", "admin user add", "admin policy attach"} {
		if !strings.Contains(logged, command) {
			t.Fatalf("mc was not asked to run %q: %s", command, logged)
		}
	}
}

func TestStorageGetRedactsSecretsFromErrors(t *testing.T) {
	manager, _ := newStorageManager(t)
	_, _ = writeFakeMC(t, manager.storageConfigDir(), fmt.Sprintf(
		`case "$args" in
  *" stat "*) printf 'stat failed with %s\n' >&2; exit 1 ;;
esac`,
		storageTestRootPass,
	))

	_, err := manager.GetStorageBucket(context.Background(), storageTestBucket, 128)
	if err == nil {
		t.Fatal("expected a stat failure")
	}
	if strings.Contains(err.Error(), storageTestRootPass) {
		t.Fatalf("error leaked a secret: %v", err)
	}
	if !strings.Contains(err.Error(), "***") {
		t.Fatalf("error was not redacted: %v", err)
	}
}

func TestStorageProvisionRedactsTenantSecret(t *testing.T) {
	manager, _ := newStorageManager(t)
	_, _ = writeFakeMC(t, manager.storageConfigDir(), fmt.Sprintf(
		`case "$args" in
  *" mb "*) printf 'mb failed with %s\n' >&2; exit 1 ;;
esac`,
		storageTestSecretKey,
	))

	_, err := manager.ProvisionStorageBucket(context.Background(), StorageBucketRequest{
		BucketName: storageTestBucket,
		AccessKey:  "tenant-access",
		SecretKey:  storageTestSecretKey,
		QuotaMB:    128,
	})
	if err == nil {
		t.Fatal("expected a bucket creation failure")
	}
	if strings.Contains(err.Error(), storageTestSecretKey) {
		t.Fatalf("error leaked the tenant secret: %v", err)
	}
	if !strings.Contains(err.Error(), "***") {
		t.Fatalf("error was not redacted: %v", err)
	}
}

func TestStorageRejectsInvalidRequests(t *testing.T) {
	manager, _ := newStorageManager(t)
	_, _ = writeFakeMC(t, manager.storageConfigDir(), "")

	if _, err := manager.ProvisionStorageBucket(context.Background(), StorageBucketRequest{
		BucketName: "not-a-bucket",
		AccessKey:  "tenant-access",
		SecretKey:  storageTestSecretKey,
		QuotaMB:    1,
	}); err == nil {
		t.Fatal("expected an invalid bucket name to be rejected")
	}

	if _, err := manager.GetStorageBucket(context.Background(), storageTestBucket, 2048); err == nil {
		t.Fatal("expected an over-limit quota to be rejected")
	}
}
