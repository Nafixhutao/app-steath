package runtime

import (
	"context"
	"strings"
	"testing"
)

// databaseRequest builds a request for the derived names of database-1, which is
// what the Control Plane sends: it stores the names it derived so the connection
// string and the agent agree.
func databaseRequest() DatabaseRequest {
	schema, role := databaseObjectNames("database-1")

	return DatabaseRequest{
		DatabaseID:     "database-1",
		ProjectID:      "project-1",
		OrganizationID: "org-1",
		DatabaseName:   schema,
		Username:       role,
		Password:       "0123456789abcdef",
		StorageLimitMB: 1024,
	}
}

func mysqlDatabaseRequest() DatabaseRequest {
	request := databaseRequest()
	request.Engine = DatabaseEngineMySQL
	request.PhpMyAdminHostname = "demo-pma.cherome.my.id"

	return request
}

// TestEnsureDatabaseProvisionsIntoTheSharedServer proves the core promise of the
// shared model: no tenant container is created, the schema and role are made
// inside the shared server, and the server joins the Project network so `db`
// resolves there.
func TestEnsureDatabaseProvisionsIntoTheSharedServer(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())
	manager.SetDatabaseServerPasswords("rootpw", "pgpw")

	state, err := manager.EnsureDatabase(context.Background(), databaseRequest())
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if state.Status != "running" || !state.Healthy {
		t.Fatalf("unexpected Database state: %+v", state)
	}
	if state.Hostname != DatabaseAlias {
		t.Fatalf("expected the %q alias, got %q", DatabaseAlias, state.Hostname)
	}
	if state.Engine != DatabaseEnginePostgres {
		t.Fatalf("expected postgres, got %q", state.Engine)
	}

	// Exactly one container is created: the shared PostgreSQL server. A tenant
	// must never get a container of its own.
	if len(docker.created) != 1 {
		t.Fatalf("expected the shared server only, got %d containers", len(docker.created))
	}
	spec := docker.created[0]
	if spec.Name != SharedPostgresContainerName {
		t.Fatalf("expected %s, got %s", SharedPostgresContainerName, spec.Name)
	}
	if spec.Image != SharedPostgresImage {
		t.Fatalf("expected %s, got %s", SharedPostgresImage, spec.Image)
	}
	if spec.Volume == nil || spec.Volume.Name != SharedPostgresVolume {
		t.Fatalf("expected the shared data Volume, got %+v", spec.Volume)
	}
	if spec.Environment["POSTGRES_PASSWORD"] != "pgpw" {
		t.Fatal("expected the server password to come from the environment")
	}

	network := projectNetwork("project-1")
	if !docker.networks[network] {
		t.Fatalf("expected the Project network %s", network)
	}
	server, ok := docker.find(SharedPostgresContainerName)
	if !ok {
		t.Fatal("expected the shared server to exist")
	}
	if _, onNetwork := server.Networks[network]; !onNetwork {
		t.Fatalf("expected the shared server on %s, got %v", network, server.Networks)
	}
	if server.Networks[network] != DatabaseAlias {
		t.Fatalf("expected the %q alias, got %q", DatabaseAlias, server.Networks[network])
	}

	// The password must travel on standard input, never in an argument.
	if !execCallWithStdin(docker.execCalls, "0123456789abcdef") {
		t.Fatal("expected the provisioning statement on standard input")
	}
	for _, call := range docker.execCalls {
		for _, arg := range call.Command {
			if strings.Contains(arg, "0123456789abcdef") {
				t.Fatalf("the password leaked into an argument: %v", call.Command)
			}
		}
	}

	schema, role := databaseObjectNames("database-1")
	if !execCallMentions(docker.execCalls, "CREATE DATABASE "+`"`+schema+`"`) {
		t.Fatalf("expected the schema %s to be created", schema)
	}
	if !execCallMentions(docker.execCalls, role) {
		t.Fatalf("expected the role %s to be created", role)
	}
}

func TestEnsureDatabaseIsIdempotent(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("second ensure: %v", err)
	}

	// The shared server is adopted, not replaced, and provisioning re-runs the
	// converging statements rather than failing.
	if len(docker.created) != 1 {
		t.Fatalf("expected the second call to adopt the server, got %d created", len(docker.created))
	}
}

func TestGetDatabaseReportsAbsentWhenThereIsNoServer(t *testing.T) {
	manager := testManager(t, newFakeDocker(), newFakeRouter())

	state, err := manager.GetDatabase(context.Background(), "database-1", 1024)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if state.Status != "absent" {
		t.Fatalf("expected absent, got %q", state.Status)
	}
	if state.StorageLimitMB != 1024 {
		t.Fatalf("expected the configured limit to be echoed, got %d", state.StorageLimitMB)
	}
}

func TestRotateDatabasePasswordUsesStdinAndNeverTheArguments(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	newPassword := "fedcba9876543210"
	if _, err := manager.RotateDatabasePassword(context.Background(), DatabasePasswordRequest{
		DatabaseID: "database-1",
		Password:   newPassword,
	}); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	if !execCallWithStdin(docker.execCalls, newPassword) {
		t.Fatal("expected the new password on standard input")
	}
	for _, call := range docker.execCalls {
		for _, arg := range call.Command {
			if strings.Contains(arg, newPassword) {
				t.Fatalf("the new password leaked into an argument: %v", call.Command)
			}
		}
	}
}

func TestRotateDatabasePasswordRedactsAFailure(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	secret := "sup3r-secret-value"
	docker.execErr = errorf("psql: could not alter role: %s", secret)
	_, err := manager.RotateDatabasePassword(context.Background(), DatabasePasswordRequest{
		DatabaseID: "database-1",
		Password:   secret,
	})
	if err == nil {
		t.Fatal("expected the rotation to fail")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("the password leaked into the error: %v", err)
	}
}

// TestRemoveDatabaseDropsTheSchemaAndRole proves removal is logical: there is no
// container to delete, only the tenant's database and role inside the shared
// server.
func TestRemoveDatabaseDropsTheSchemaAndRole(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), databaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	removed, err := manager.RemoveDatabase(context.Background(), "database-1")
	if err != nil {
		t.Fatalf("remove: %v", err)
	}
	if !removed {
		t.Fatal("expected the Database to be reported as removed")
	}

	schema, role := databaseObjectNames("database-1")
	if !execCallMentions(docker.execCalls, "DROP DATABASE IF EXISTS "+`"`+schema+`"`) {
		t.Fatalf("expected the schema %s to be dropped", schema)
	}
	if !execCallMentions(docker.execCalls, "DROP ROLE "+`"`+role+`"`) {
		t.Fatalf("expected the role %s to be dropped", role)
	}

	// The shared server itself must survive: other tenants depend on it.
	if _, ok := docker.find(SharedPostgresContainerName); !ok {
		t.Fatal("expected the shared server to keep running")
	}
}

// TestEnforceDatabasesLocksAnOverQuotaRole proves the shared model's only quota
// lever: a tenant past its limit has its role locked, and a tenant under it is
// unlocked again.
func TestEnforceDatabasesLocksAnOverQuotaRole(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:         SharedPostgresContainerName,
		Network:      "stealth_default",
		NetworkAlias: SharedPostgresContainerName,
		Image:        SharedPostgresImage,
		Port:         DatabasePort,
		Labels:       map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		t.Fatalf("seed the shared server: %v", err)
	}
	docker.tenantUsage = map[string]int64{
		schemaNameFor("database-1"): MaxDatabaseStorageMB + 1,
	}
	docker.tenantList = map[string][]string{
		SharedPostgresContainerName: {schemaNameFor("database-1")},
	}

	locked, err := manager.EnforceDatabases(context.Background())
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	if locked != 1 {
		t.Fatalf("expected one locked Database, got %d", locked)
	}
	if !execCallMentions(docker.execCalls, "WITH NOLOGIN") {
		t.Fatal("expected the over-quota role to be locked")
	}
}

func TestEnforceDatabasesLeavesARoleUnderItsLimitAlone(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:         SharedPostgresContainerName,
		Network:      "stealth_default",
		NetworkAlias: SharedPostgresContainerName,
		Image:        SharedPostgresImage,
		Port:         DatabasePort,
		Labels:       map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		t.Fatalf("seed the shared server: %v", err)
	}
	docker.tenantUsage = map[string]int64{
		schemaNameFor("database-1"): MaxDatabaseStorageMB - 1,
	}
	docker.tenantList = map[string][]string{
		SharedPostgresContainerName: {schemaNameFor("database-1")},
	}

	locked, err := manager.EnforceDatabases(context.Background())
	if err != nil {
		t.Fatalf("enforce: %v", err)
	}
	if locked != 0 {
		t.Fatalf("expected no locked Database, got %d", locked)
	}
	if !execCallMentions(docker.execCalls, "WITH LOGIN") {
		t.Fatal("expected the role to be left unlocked")
	}
}

func TestCleanupKeepsTheSharedDatabaseVolumes(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if err := docker.EnsureVolume(context.Background(), VolumeSpec{
		Name:   SharedPostgresVolume,
		Labels: map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		t.Fatalf("seed the Volume: %v", err)
	}

	removed, err := manager.pruneOrphanDatabaseVolumes(context.Background())
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if removed != 0 {
		t.Fatalf("expected the shared Volume to be kept, removed %d", removed)
	}
	if _, ok := docker.volumes[SharedPostgresVolume]; !ok {
		t.Fatal("expected the shared data Volume to survive cleanup")
	}
}

func TestCleanupRemovesALeftoverPerDatabaseVolume(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	// A Volume from the old per-Project model carries a databaseId.
	if err := docker.EnsureVolume(context.Background(), VolumeSpec{
		Name: "stealth-dbvol-database-1",
		Labels: map[string]string{
			LabelType:       ResourceTypeDatabase,
			LabelDatabaseID: "database-1",
		},
	}); err != nil {
		t.Fatalf("seed the Volume: %v", err)
	}

	removed, err := manager.pruneOrphanDatabaseVolumes(context.Background())
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected the leftover Volume to be removed, got %d", removed)
	}
}

func TestDatabaseRequestRejectsUnsafeValues(t *testing.T) {
	cases := map[string]func(*DatabaseRequest){
		"no database id":    func(r *DatabaseRequest) { r.DatabaseID = "" },
		"no project id":     func(r *DatabaseRequest) { r.ProjectID = "" },
		"no organization":   func(r *DatabaseRequest) { r.OrganizationID = "" },
		"empty password":    func(r *DatabaseRequest) { r.Password = "" },
		"NUL in password":   func(r *DatabaseRequest) { r.Password = "abc\x00def" },
		"too much storage":  func(r *DatabaseRequest) { r.StorageLimitMB = MaxDatabaseStorageMB + 1 },
		"no storage limit":  func(r *DatabaseRequest) { r.StorageLimitMB = 0 },
		"unknown engine":    func(r *DatabaseRequest) { r.Engine = "sqlite" },
		"forged schema":     func(r *DatabaseRequest) { r.DatabaseName = "someone_elses" },
		"forged role":       func(r *DatabaseRequest) { r.Username = "root" },
		"pma on postgres":   func(r *DatabaseRequest) { r.PhpMyAdminHostname = "x.cherome.my.id" },
		"mysql without pma": func(r *DatabaseRequest) { r.Engine = DatabaseEngineMySQL },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			request := databaseRequest()
			mutate(&request)
			if err := request.validate(); err == nil {
				t.Fatalf("expected %s to be rejected", name)
			}
		})
	}
}

// TestEnsureDatabaseStartsMySQLWithPhpMyAdmin proves the MySQL path: the shared
// MySQL server and the shared phpMyAdmin are the only containers, and the browser
// client is routed on the Platform Domain.
func TestEnsureDatabaseStartsMySQLWithPhpMyAdmin(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)
	manager.SetDatabaseServerPasswords("rootpw", "pgpw")

	state, err := manager.EnsureDatabase(context.Background(), mysqlDatabaseRequest())
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if state.Engine != DatabaseEngineMySQL {
		t.Fatalf("expected mysql, got %q", state.Engine)
	}
	if !state.PhpMyAdminReady {
		t.Fatal("expected phpMyAdmin to be reported ready")
	}

	names := make([]string, 0, len(docker.created))
	for _, spec := range docker.created {
		names = append(names, spec.Name)
	}
	if len(names) != 2 {
		t.Fatalf("expected the MySQL server and phpMyAdmin only, got %v", names)
	}
	for _, want := range []string{SharedMySQLContainerName, SharedPhpMyAdminContainerName} {
		if !containsString(names, want) {
			t.Fatalf("expected %s to be created, got %v", want, names)
		}
	}

	pma, ok := docker.find(SharedPhpMyAdminContainerName)
	if !ok {
		t.Fatal("expected phpMyAdmin to exist")
	}
	if pma.Labels[LabelHostname] != "demo-pma.cherome.my.id" {
		t.Fatalf("unexpected phpMyAdmin hostname: %s", pma.Labels[LabelHostname])
	}
	if !containsString(router.hostnames(), "demo-pma.cherome.my.id") {
		t.Fatalf("expected the phpMyAdmin route, got %v", router.hostnames())
	}

	// MySQL provisioning uses the container's root account through the shared
	// server, never a host credential.
	if !execCallMentions(docker.execCalls, "MYSQL_ROOT_PASSWORD") {
		t.Fatal("expected MySQL provisioning through the root account")
	}
}

// TestEnsureDatabaseRejectsAMismatchedEngine covers the two never-mixed choices:
// a MySQL request against a running PostgreSQL schema would silently write to the
// wrong server, so a forged name is refused.
func TestEnsureDatabaseRejectsAMismatchedEngine(t *testing.T) {
	request := mysqlDatabaseRequest()
	request.Engine = "oracle"
	if err := request.validate(); err == nil {
		t.Fatal("expected an unknown engine to be rejected")
	}
}

func TestMySQLRequestRequiresAPhpMyAdminHostname(t *testing.T) {
	request := mysqlDatabaseRequest()
	request.PhpMyAdminHostname = ""
	if err := request.validate(); err == nil {
		t.Fatal("expected a MySQL request without a hostname to be rejected")
	}
}

// TestRemoveDatabaseDropsThePhpMyAdminRoute proves the browser client's route is
// removed with the Database, and that the shared sidecar survives for other
// tenants.
func TestRemoveDatabaseDropsThePhpMyAdminSidecarAndItsRoute(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := manager.EnsureDatabase(context.Background(), mysqlDatabaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	if _, err := manager.RemoveDatabase(context.Background(), "database-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}

	schema, _ := databaseObjectNames("database-1")
	if !execCallMentions(docker.execCalls, "DROP DATABASE IF EXISTS "+"`"+schema+"`") {
		t.Fatalf("expected the schema %s to be dropped", schema)
	}
	if _, ok := docker.find(SharedMySQLContainerName); !ok {
		t.Fatal("expected the shared MySQL server to keep running")
	}
}

func TestRotateMySQLPasswordUsesStdinAndTheContainerRootAccount(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	if _, err := manager.EnsureDatabase(context.Background(), mysqlDatabaseRequest()); err != nil {
		t.Fatalf("ensure: %v", err)
	}

	newPassword := "mysql-rotated-value"
	if _, err := manager.RotateDatabasePassword(context.Background(), DatabasePasswordRequest{
		DatabaseID: "database-1",
		Engine:     DatabaseEngineMySQL,
		Password:   newPassword,
	}); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	if !execCallWithStdin(docker.execCalls, newPassword) {
		t.Fatal("expected the new password on standard input")
	}
	if !execCallMentions(docker.execCalls, "MYSQL_ROOT_PASSWORD") {
		t.Fatal("expected the rotation through the container's root account")
	}
}

// TestCleanupRemovesALeftoverPhpMyAdmin proves a sidecar from the per-Project
// model is cleaned up, route first, while the shared one is kept.
func TestCleanupRemovesALeftoverPhpMyAdmin(t *testing.T) {
	docker := newFakeDocker()
	router := newFakeRouter()
	manager := testManager(t, docker, router)

	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:  "stealth-pma-database-1",
		Image: SharedPhpMyAdminImage,
		Labels: map[string]string{
			LabelType:     ResourceTypeDatabasePhpMyAdmin,
			LabelHostname: "old-pma.cherome.my.id",
		},
	}); err != nil {
		t.Fatalf("seed the leftover: %v", err)
	}
	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:  SharedPhpMyAdminContainerName,
		Image: SharedPhpMyAdminImage,
		Labels: map[string]string{
			LabelType:     ResourceTypeDatabasePhpMyAdmin,
			LabelHostname: "demo-pma.cherome.my.id",
		},
	}); err != nil {
		t.Fatalf("seed the shared client: %v", err)
	}

	removed, err := manager.pruneOrphanPhpMyAdmin(context.Background())
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if removed != 1 {
		t.Fatalf("expected the leftover to be removed, got %d", removed)
	}
	if _, ok := docker.find("stealth-pma-database-1"); ok {
		t.Fatal("expected the leftover phpMyAdmin to be gone")
	}
	if _, ok := docker.find(SharedPhpMyAdminContainerName); !ok {
		t.Fatal("expected the shared phpMyAdmin to be kept")
	}
}

// TestEnsureDatabaseRefusesThePublicProxy proves the shared model never offers a
// public listener: one port would expose every tenant's schema.
func TestEnsureDatabaseRefusesThePublicProxy(t *testing.T) {
	docker := newFakeDocker()
	manager := testManager(t, docker, newFakeRouter())

	_, err := manager.EnsureDatabaseProxy(context.Background(), DatabaseProxyRequest{
		DatabaseID: "database-1",
		ProjectID:  "project-1",
		Allowlist:  []string{"203.0.113.0/24"},
	})
	if err == nil {
		t.Fatal("expected the public proxy to be refused")
	}
	if !strings.Contains(err.Error(), ErrDatabaseProxyDisabled.Error()) {
		t.Fatalf("expected %v, got %v", ErrDatabaseProxyDisabled, err)
	}
}

// helper: execCallWithStdin reports whether any Exec carried the secret on stdin.
func execCallWithStdin(calls []fakeExec, secret string) bool {
	for _, call := range calls {
		if strings.Contains(call.Stdin, secret) {
			return true
		}
	}

	return false
}

// helper: execCallMentions reports whether any Exec argument or stdin mentions
// the fragment.
func execCallMentions(calls []fakeExec, fragment string) bool {
	for _, call := range calls {
		if strings.Contains(call.Stdin, fragment) {
			return true
		}
		for _, arg := range call.Command {
			if strings.Contains(arg, fragment) {
				return true
			}
		}
	}

	return false
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}

	return false
}

// seedSharedServer puts a running shared engine server in the fake, which is
// what Backup and Restore resolve a Database to.
func seedSharedServer(t *testing.T, docker *fakeDocker, engine string) {
	t.Helper()

	server := sharedServerFor(engine)
	if _, err := docker.CreateContainer(context.Background(), ContainerSpec{
		Name:         server.Name,
		Network:      "stealth_default",
		NetworkAlias: server.Name,
		Image:        server.Image,
		Port:         server.Port,
		Labels:       map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		t.Fatalf("seed the shared %s server: %v", engine, err)
	}

	// Engine detection asks the server whether it holds the Database's schema, so
	// the fixture has to answer the listing query.
	if docker.tenantList == nil {
		docker.tenantList = make(map[string][]string)
	}
	docker.tenantList[server.Name] = append(
		docker.tenantList[server.Name], schemaNameFor("database-1"),
	)
}
