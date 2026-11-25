package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// The Storage feature gives every Project a bucket on one shared MinIO server.
// Only the Node Agent holds the server's admin credentials, so the Control Plane
// asks the agent to create, inspect, and remove buckets through this file.
const (
	// storageAlias is local to the agent's mc config dir; it is never a public name.
	storageAlias = "stealth-storage"
	// storageEndpoint is the Compose network address of the shared MinIO server.
	storageEndpoint = "http://minio:9000"
	// storageUpstream is the Caddy upstream for the public S3 hostname.
	storageUpstream = "minio:9000"

	// MaxStorageQuotaMB mirrors the platform quota: one bucket is capped at 1024 MiB.
	MaxStorageQuotaMB = 1024

	storageStatusReady        = "ready"
	storageStatusFailed       = "failed"
	storageStatusProvisioning = "provisioning"
)

// ErrInvalidStorageBucket is returned for a request the agent cannot honour.
var ErrInvalidStorageBucket = errors.New("invalid storage bucket request")

// ErrUnknownStorageBucket is returned when the physical bucket is gone.
var ErrUnknownStorageBucket = errors.New("unknown storage bucket")

// storageBucketNamePattern is the shape the Control Plane generates. It also
// keeps bucket names safe to use as file names and mc arguments.
var storageBucketNamePattern = regexp.MustCompile(`^sb-[a-z0-9]{24}$`)

// StorageBucketRequest describes one tenant bucket and the IAM user that can
// reach it. The secret key is carried in the request body only.
type StorageBucketRequest struct {
	BucketName string
	AccessKey  string
	SecretKey  string
	Public     bool
	QuotaMB    int
}

// StorageBucketState is what the Control Plane reads back about a bucket.
type StorageBucketState struct {
	Status  string
	Healthy bool
	Public  bool
	UsageMB int
	QuotaMB int
}

// StorageBucketRemoval reports whether this call removed anything.
type StorageBucketRemoval struct {
	BucketID string
	Removed  bool
}

// storageUserMessage is the subset of `mc admin user list --json` needed to
// find the tenant user again after an agent restart.
type storageUserMessage struct {
	AccessKey  string `json:"accessKey"`
	PolicyName string `json:"policyName"`
}

// storageUsageMessage is one line of `mc du --json`.
type storageUsageMessage struct {
	Size int64 `json:"size"`
}

// SetStorageCredentials stores the shared MinIO admin credentials. It is called
// once at startup from the environment; the values are never logged, and mc
// reads them from stdin rather than from its command line.
func (m *Manager) SetStorageCredentials(rootUser, rootPassword string) {
	m.storageMu.Lock()
	defer m.storageMu.Unlock()

	m.storageRootUser = rootUser
	m.storageRootPassword = rootPassword
}

// SetStorageHostname sets the public S3 hostname Caddy must serve. An empty
// hostname disables route programming, so a node without PLATFORM_DOMAIN never
// installs a route to nowhere.
func (m *Manager) SetStorageHostname(hostname string) {
	m.storageMu.Lock()
	defer m.storageMu.Unlock()

	m.storageHostname = strings.TrimSpace(hostname)
}

// SetStorageDir selects where mc's isolated config and the temporary policy
// documents live. It is a directory under the agent work root in production.
func (m *Manager) SetStorageDir(dir string) {
	m.storageMu.Lock()
	defer m.storageMu.Unlock()

	m.storageDir = strings.TrimSpace(dir)
}

// EnsureStorageRoute installs the public S3 hostname once. It is safe to call
// before MinIO is up: Caddy can hold a route whose upstream starts later.
func (m *Manager) EnsureStorageRoute(ctx context.Context) error {
	m.storageMu.Lock()
	hostname := m.storageHostname
	m.storageMu.Unlock()

	if hostname == "" {
		return nil
	}

	return m.router.PutRoute(ctx, Route{Hostname: hostname, Upstream: storageUpstream})
}

// ProvisionStorageBucket creates the bucket, its hard quota, its dedicated IAM
// user, and the bucket-scoped policy. Repeating the call is idempotent: every mc
// step either ignores existing state or replaces it with the same value.
func (m *Manager) ProvisionStorageBucket(
	ctx context.Context,
	request StorageBucketRequest,
) (StorageBucketState, error) {
	if err := validateStorageBucketRequest(request); err != nil {
		return StorageBucketState{Status: storageStatusFailed}, err
	}

	if err := m.ensureStorage(ctx); err != nil {
		return StorageBucketState{Status: storageStatusFailed}, err
	}

	secrets := m.storageSecrets(request.AccessKey, request.SecretKey)
	target := storageAlias + "/" + request.BucketName

	if _, err := m.runMC(ctx, "", secrets, "mb", "--ignore-existing", target); err != nil {
		return m.failedStorageState(request, err)
	}
	if _, err := m.runMC(
		ctx,
		"",
		secrets,
		"quota",
		"set",
		target,
		"--size",
		strconv.Itoa(request.QuotaMB)+"MiB",
	); err != nil {
		return m.failedStorageState(request, err)
	}

	policyName := storagePolicyName(request.BucketName)
	policyPath, err := m.writeStoragePolicy(request.BucketName)
	if err != nil {
		return m.failedStorageState(request, err)
	}
	defer os.Remove(policyPath)

	if _, err := m.runMC(
		ctx,
		"",
		secrets,
		"admin",
		"policy",
		"create",
		storageAlias,
		policyName,
		policyPath,
	); err != nil && !storageAlreadyExists(err) {
		return m.failedStorageState(request, err)
	}

	// `mc admin user add` reads both keys from stdin when they are omitted from
	// the arguments, so neither key appears in the process list.
	userKeys := request.AccessKey + "\n" + request.SecretKey + "\n"
	if _, err := m.runMC(ctx, userKeys, secrets, "admin", "user", "add", storageAlias); err != nil {
		return m.failedStorageState(request, err)
	}
	if _, err := m.runMC(
		ctx,
		"",
		secrets,
		"admin",
		"policy",
		"attach",
		storageAlias,
		policyName,
		"--user",
		request.AccessKey,
	); err != nil {
		return m.failedStorageState(request, err)
	}

	permission := "none"
	if request.Public {
		permission = "download"
	}
	if _, err := m.runMC(ctx, "", secrets, "anonymous", "set", permission, target); err != nil {
		return m.failedStorageState(request, err)
	}

	m.rememberStorageUser(request.BucketName, request.AccessKey)

	return StorageBucketState{
		Status:  storageStatusReady,
		Healthy: true,
		Public:  request.Public,
		QuotaMB: request.QuotaMB,
	}, nil
}

// GetStorageBucket checks that the bucket exists and that MinIO is answering,
// then measures its usage. A usage measurement failure is not a bucket failure:
// the Control Plane still gets a healthy state with 0 MB used.
func (m *Manager) GetStorageBucket(
	ctx context.Context,
	bucketID string,
	quotaMB int,
) (StorageBucketState, error) {
	state := StorageBucketState{Status: storageStatusFailed, QuotaMB: quotaMB}
	if !storageBucketNamePattern.MatchString(bucketID) {
		return state, ErrUnknownStorageBucket
	}
	if quotaMB < 1 || quotaMB > MaxStorageQuotaMB {
		return state, fmt.Errorf("%w: quotaMb must be between 1 and %d", ErrInvalidStorageBucket, MaxStorageQuotaMB)
	}
	if err := m.ensureStorage(ctx); err != nil {
		return state, err
	}

	target := storageAlias + "/" + bucketID
	if _, err := m.runMC(ctx, "", m.storageSecrets(), "stat", target); err != nil {
		if storageMissing(err) {
			return state, ErrUnknownStorageBucket
		}
		return state, err
	}

	state.Status = storageStatusReady
	state.Healthy = true
	state.Public = m.storagePublic(ctx, target)
	state.UsageMB = m.storageUsageMB(ctx, target)

	return state, nil
}

// RemoveStorageBucket deletes the bucket, the tenant IAM user, and the policy.
// Each step tolerates an object that is already gone, so a retried delete never
// fails and reports `Removed: false` when there was nothing left to clean up.
func (m *Manager) RemoveStorageBucket(ctx context.Context, bucketID string) (StorageBucketRemoval, error) {
	result := StorageBucketRemoval{BucketID: bucketID}
	if !storageBucketNamePattern.MatchString(bucketID) {
		return result, nil
	}
	if err := m.ensureStorage(ctx); err != nil {
		return result, err
	}

	secrets := m.storageSecrets()
	target := storageAlias + "/" + bucketID
	policyName := storagePolicyName(bucketID)

	if _, err := m.runMC(ctx, "", secrets, "rb", "--force", target); err != nil {
		if !storageMissing(err) {
			return result, err
		}
	} else {
		result.Removed = true
	}

	for _, accessKey := range m.storageUsers(ctx, bucketID) {
		if _, err := m.runMC(ctx, "", secrets, "admin", "user", "remove", storageAlias, accessKey); err != nil {
			if !storageMissing(err) {
				return result, err
			}
			continue
		}
		result.Removed = true
	}

	if _, err := m.runMC(ctx, "", secrets, "admin", "policy", "remove", storageAlias, policyName); err != nil {
		if !storageMissing(err) {
			return result, err
		}
	} else {
		result.Removed = true
	}

	m.forgetStorageUser(bucketID)

	return result, nil
}

// ensureStorage configures an isolated mc alias and checks that MinIO answers.
// It runs before every operation so a fresh mc config (or a restarted server)
// cannot leave a request talking to a stale alias.
func (m *Manager) ensureStorage(ctx context.Context) error {
	m.storageMu.Lock()
	rootUser := m.storageRootUser
	rootPassword := m.storageRootPassword
	m.storageMu.Unlock()

	if rootUser == "" || rootPassword == "" {
		return fmt.Errorf("%w: the MinIO admin credentials are not configured", ErrInvalidStorageBucket)
	}
	// Both keys are fed to mc through stdin; a newline would turn one key into
	// two prompt answers, so reject it instead of talking to the wrong account.
	if strings.ContainsAny(rootUser, "\r\n") || strings.ContainsAny(rootPassword, "\r\n") {
		return fmt.Errorf("%w: the MinIO admin credentials contain a newline", ErrInvalidStorageBucket)
	}

	secrets := m.storageSecrets()
	keys := rootUser + "\n" + rootPassword + "\n"
	if _, err := m.runMC(
		ctx,
		keys,
		secrets,
		"alias",
		"set",
		storageAlias,
		storageEndpoint,
		"--api",
		"S3v4",
		"--path",
		"on",
	); err != nil {
		return err
	}
	if _, err := m.runMC(ctx, "", secrets, "ready", storageAlias); err != nil {
		return err
	}

	return nil
}

// runMC executes one mc command with an isolated config directory. Secrets are
// passed only through stdin, and any secret that still shows up in the command's
// output is replaced before the error is returned to the API handler.
func (m *Manager) runMC(
	ctx context.Context,
	stdin string,
	secrets []string,
	args ...string,
) (string, error) {
	// Read the work directory before taking the lock: storageConfigDir locks the
	// same mutex to protect its own fields.
	configDir := filepath.Join(m.storageConfigDir(), ".mc")

	m.storageMu.Lock()
	defer m.storageMu.Unlock()

	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return "", fmt.Errorf("prepare the mc config directory: %w", err)
	}

	binary := strings.TrimSpace(os.Getenv("MC_BIN"))
	if binary == "" {
		binary = "mc"
	}
	fullArgs := append([]string{"--config-dir", configDir, "--no-color"}, args...)
	cmd := exec.CommandContext(ctx, binary, fullArgs...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf(
			"mc %s: %w: %s",
			strings.Join(args, " "),
			err,
			redactStorageSecrets(string(output), secrets),
		)
	}

	return string(output), nil
}

// storageConfigDir returns the work directory holding policy files and mc's
// config. The fallback keeps the Manager usable in tests without a work root.
func (m *Manager) storageConfigDir() string {
	m.storageMu.Lock()
	dir := m.storageDir
	m.storageMu.Unlock()

	if dir != "" {
		return dir
	}

	return filepath.Join(os.TempDir(), "stealth-agent-storage")
}

// storageSecrets returns every value that must never reach a log or an error.
func (m *Manager) storageSecrets(extra ...string) []string {
	m.storageMu.Lock()
	secrets := make([]string, 0, len(extra)+2)
	if m.storageRootUser != "" {
		secrets = append(secrets, m.storageRootUser)
	}
	if m.storageRootPassword != "" {
		secrets = append(secrets, m.storageRootPassword)
	}
	m.storageMu.Unlock()

	return append(secrets, extra...)
}

// redactStorageSecrets removes known credentials from command output. Short
// values are skipped so a one-character setting cannot erase every character
// in an unrelated error message.
func redactStorageSecrets(output string, secrets []string) string {
	for _, secret := range secrets {
		if len(secret) < 4 {
			continue
		}
		output = strings.ReplaceAll(output, secret, "***")
	}

	return strings.TrimSpace(output)
}

// writeStoragePolicy writes a bucket-scoped policy into the agent work dir. The
// caller removes the file once `mc admin policy create` has consumed it.
func (m *Manager) writeStoragePolicy(bucketName string) (string, error) {
	dir := m.storageConfigDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("prepare the Storage work directory: %w", err)
	}

	file, err := os.CreateTemp(dir, "policy-*.json")
	if err != nil {
		return "", fmt.Errorf("create the Storage policy file: %w", err)
	}
	defer file.Close()

	policy := map[string]any{
		"Version": "2012-10-17",
		"Statement": []any{
			map[string]any{
				"Effect": "Allow",
				"Action": []string{"s3:ListBucket", "s3:GetBucketLocation"},
				"Resource": []string{
					"arn:aws:s3:::" + bucketName,
				},
			},
			map[string]any{
				"Effect": "Allow",
				"Action": []string{
					"s3:GetObject",
					"s3:PutObject",
					"s3:DeleteObject",
					"s3:GetObjectVersion",
					"s3:DeleteObjectVersion",
				},
				"Resource": []string{
					"arn:aws:s3:::" + bucketName + "/*",
				},
			},
			map[string]any{
				"Effect":   "Allow",
				"Action":   []string{"s3:ListAllMyBuckets"},
				"Resource": []string{"arn:aws:s3:::*"},
			},
		},
	}
	if err := json.NewEncoder(file).Encode(policy); err != nil {
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("write the Storage policy: %w", err)
	}

	return file.Name(), nil
}

// storagePublic reads the bucket's anonymous policy. A parse failure means
// "private", which is the safe answer and never fails a health check.
func (m *Manager) storagePublic(ctx context.Context, target string) bool {
	output, err := m.runMC(ctx, "", m.storageSecrets(), "--json", "anonymous", "get", target)
	if err != nil {
		return false
	}

	return strings.Contains(output, `"s3:GetObject"`) && strings.Contains(output, `"Allow"`)
}

// storageUsageMB sums `mc du --json` sizes and rounds up to whole MiB. A parse
// failure reports 0 instead of failing the whole health check.
func (m *Manager) storageUsageMB(ctx context.Context, target string) int {
	output, err := m.runMC(ctx, "", m.storageSecrets(), "--json", "du", target)
	if err != nil {
		return 0
	}

	var bytes int64
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var message storageUsageMessage
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			return 0
		}
		bytes += message.Size
	}
	if bytes <= 0 {
		return 0
	}

	return int((bytes + 1024*1024 - 1) / (1024 * 1024))
}

// storageUsers returns the access keys attached to the bucket's policy. The
// in-memory map covers the normal case; listing MinIO's users covers a delete
// after an agent restart, when the map is empty.
func (m *Manager) storageUsers(ctx context.Context, bucketID string) []string {
	policyName := storagePolicyName(bucketID)
	seen := make(map[string]bool)
	users := make([]string, 0, 2)

	m.storageMu.Lock()
	if accessKey := m.storageUsersByBucket[bucketID]; accessKey != "" {
		seen[accessKey] = true
		users = append(users, accessKey)
	}
	m.storageMu.Unlock()

	output, err := m.runMC(ctx, "", m.storageSecrets(), "--json", "admin", "user", "list", storageAlias)
	if err == nil {
		for _, line := range strings.Split(output, "\n") {
			var message storageUserMessage
			if err := json.Unmarshal([]byte(line), &message); err != nil {
				continue
			}
			if message.PolicyName != policyName || message.AccessKey == "" || seen[message.AccessKey] {
				continue
			}
			seen[message.AccessKey] = true
			users = append(users, message.AccessKey)
		}
	}

	return users
}

func (m *Manager) rememberStorageUser(bucketID, accessKey string) {
	m.storageMu.Lock()
	defer m.storageMu.Unlock()

	if m.storageUsersByBucket == nil {
		m.storageUsersByBucket = make(map[string]string)
	}
	m.storageUsersByBucket[bucketID] = accessKey
}

func (m *Manager) forgetStorageUser(bucketID string) {
	m.storageMu.Lock()
	defer m.storageMu.Unlock()

	delete(m.storageUsersByBucket, bucketID)
}

func (m *Manager) failedStorageState(
	request StorageBucketRequest,
	err error,
) (StorageBucketState, error) {
	return StorageBucketState{
		Status:  storageStatusFailed,
		QuotaMB: request.QuotaMB,
	}, err
}

func validateStorageBucketRequest(request StorageBucketRequest) error {
	switch {
	case !storageBucketNamePattern.MatchString(request.BucketName):
		return fmt.Errorf("%w: bucketName is not valid", ErrInvalidStorageBucket)
	case strings.TrimSpace(request.AccessKey) == "",
		strings.ContainsAny(request.AccessKey, "\r\n"),
		len(request.AccessKey) > 128:
		return fmt.Errorf("%w: accessKey is not valid", ErrInvalidStorageBucket)
	case strings.TrimSpace(request.SecretKey) == "",
		strings.ContainsAny(request.SecretKey, "\r\n"),
		len(request.SecretKey) > 256:
		return fmt.Errorf("%w: secretKey is not valid", ErrInvalidStorageBucket)
	case request.QuotaMB < 1 || request.QuotaMB > MaxStorageQuotaMB:
		return fmt.Errorf(
			"%w: quotaMb must be between 1 and %d",
			ErrInvalidStorageBucket,
			MaxStorageQuotaMB,
		)
	}

	return nil
}

func storagePolicyName(bucketName string) string {
	return bucketName + "-policy"
}

// storageAlreadyExists lets a retried Provision succeed when an mc command
// refuses to overwrite state that already has the desired value.
func storageAlreadyExists(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "already exist")
}

// storageMissing recognises the mc wordings for an absent bucket, user, or
// policy. It keeps Remove idempotent across server restarts and retries.
func storageMissing(err error) bool {
	message := strings.ToLower(err.Error())
	for _, phrase := range []string{
		"does not exist",
		"not found",
		"no such bucket",
		"bucket not found",
		"unknown user",
	} {
		if strings.Contains(message, phrase) {
			return true
		}
	}

	return false
}
