package runtime

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

// A Project Database is a logical database inside a shared engine server.
//
// The node runs one MySQL 8 server (`stealth-mysql`) and one PostgreSQL 16
// server (`stealth-pgdb`) for every tenant. A Project Database is a database plus
// a role inside one of them, not a container of its own. That is the free-tier
// trade-off: a shared server costs a few hundred megabytes once, while a
// dedicated container per Database would need 512 MB each and cannot fit more
// than a handful on the VPS.
//
// Isolation therefore lives in the engine, not in the container:
//
//   - Each Database owns a schema name and a role name derived from its id.
//   - The role is granted privileges on its own schema only, so one tenant
//     cannot read another's tables.
//   - The shared server joins each Project network under the `db` alias, so the
//     hostname in `DATABASE_URL` is the same for every Project and engine.
//
// `stealth-pgdb` is deliberately separate from `stealth-postgres`, the Control
// Plane's own database. Attaching the platform's control database to every
// tenant network would put it one `docker exec` away from any Service.
const (
	// DatabaseEnginePostgres and DatabaseEngineMySQL are the only engines.
	DatabaseEnginePostgres = "postgres"
	DatabaseEngineMySQL    = "mysql"

	DatabaseVersion      = "16"
	DatabaseVersionMySQL = "8"

	// DatabaseAlias is what a Service connects to. Every shared server joins a
	// Project network under this alias, so the connection string never changes.
	DatabaseAlias = "db"
	DatabasePort  = 5432
	MySQLPort     = 3306

	// SharedMySQLContainerName is the one MySQL server for the node.
	SharedMySQLContainerName = "stealth-mysql"
	// SharedPostgresContainerName is the tenant PostgreSQL server. It is not the
	// Control Plane's `stealth-postgres`.
	SharedPostgresContainerName = "stealth-pgdb"
	// SharedPhpMyAdminContainerName is the one phpMyAdmin for the node.
	SharedPhpMyAdminContainerName = "stealth-pma"

	// SharedMySQLVolume and SharedPostgresVolume keep the tenant data across a
	// restart of either server.
	SharedMySQLVolume    = "stealth_mysql_data"
	SharedPostgresVolume = "stealth_pgdb_data"

	// MySQLDataMountPath and PostgresDataMountPath are where the servers keep
	// their data inside the container.
	MySQLDataMountPath    = "/var/lib/mysql"
	PostgresDataMountPath = "/var/lib/postgresql/data"

	// sharedPostgresAdmin is the superuser `stealth-pgdb` is created with. The
	// agent uses it over the container's trusted local socket to provision and
	// drop tenant roles and databases.
	sharedPostgresAdmin = "stealth"

	// sharedServerMemoryMB bounds one shared server; 512 MB each leaves room for
	// the Control Plane, the Agent, Caddy and a handful of Services.
	sharedServerMemoryMB = 512
	sharedServerCPU      = 0.5

	// MaxDatabaseStorageMB is the spec limit for one Project Database. A shared
	// server has no per-database disk quota, so the agent measures each tenant
	// schema against this and locks the role when it grows past it.
	MaxDatabaseStorageMB = 1024

	// SharedMySQLImage and SharedPhpMyAdminImage are pinned. The servers are
	// long-lived, so a floating tag would upgrade under the user's data.
	SharedMySQLImage      = "mysql:8.4"
	SharedPostgresImage   = "postgres:16-alpine"
	SharedPhpMyAdminImage = "phpmyadmin:5-apache"

	// phpMyAdminPort is the port phpMyAdmin listens on, and phpMyAdminAlias is
	// the Caddy upstream alias.
	phpMyAdminPort  = 80
	phpMyAdminAlias = "pma"

	// phpMyAdminMaxUploadMB bounds an import through the browser client.
	phpMyAdminMaxUploadMB = 64

	// databaseReadyTimeout bounds how long provisioning waits for a shared
	// server to accept connections.
	databaseReadyTimeout = 2 * time.Minute
)

// ErrUnknownDatabase is returned when a Database has no schema on this node.
var ErrUnknownDatabase = errors.New("unknown database")

// ErrInvalidDatabase is returned for a Database request that cannot be honoured.
var ErrInvalidDatabase = errors.New("invalid database request")

// ErrDatabaseProxyDisabled is returned for every public proxy request. A raw TCP
// listener forwards to one server port and cannot isolate a tenant's database, so
// with shared servers the proxy is not offered at all.
var ErrDatabaseProxyDisabled = errors.New("the public database proxy is not available")

// DatabaseRequest asks the agent to provision a Database's schema and role.
type DatabaseRequest struct {
	DatabaseID     string
	ProjectID      string
	OrganizationID string
	// Engine selects PostgreSQL or MySQL. Empty means PostgreSQL.
	Engine string
	// PhpMyAdminHostname is the address the shared phpMyAdmin answers on. Every
	// MySQL Database reports the same value.
	PhpMyAdminHostname string
	// DatabaseName and Username are the schema and role to create. The Control
	// Plane derives them from the Database id and stores them, so the connection
	// string it builds names the same objects the agent creates.
	DatabaseName   string
	Username       string
	Password       string
	StorageLimitMB int
}

// DatabasePasswordRequest replaces a Database role's password.
type DatabasePasswordRequest struct {
	DatabaseID string
	Engine     string
	Password   string
}

// DatabaseState is what the Control Plane reads back about a Database.
type DatabaseState struct {
	DatabaseID      string
	Engine          string
	Status          string
	ContainerID     string
	Hostname        string
	StorageLimitMB  int
	UsageMB         int64
	Healthy         bool
	PhpMyAdminReady bool
	OverQuota       bool
}

// normaliseEngine maps an empty engine to PostgreSQL so a request written before
// engines existed still provisions what it used to.
func normaliseEngine(engine string) (string, error) {
	switch engine {
	case "", DatabaseEnginePostgres:
		return DatabaseEnginePostgres, nil
	case DatabaseEngineMySQL:
		return DatabaseEngineMySQL, nil
	default:
		return "", fmt.Errorf("%w: unknown engine %q", ErrInvalidDatabase, engine)
	}
}

// sharedServer describes one long-lived engine server.
type sharedServer struct {
	Name       string
	Image      string
	Port       int
	Volume     string
	MountPath  string
	MemoryMB   int
	CPU        float64
	Env        map[string]string
	Command    []string
	ReadyProbe []string
	// Capabilities are the few the engine's official image needs to start. The
	// Agent drops every capability by default, and both servers run their
	// entrypoint as root before switching to the service user, which fails
	// without these.
	Capabilities []string
}

func sharedServerFor(engine string) sharedServer {
	if engine == DatabaseEngineMySQL {
		return sharedServer{
			Name:      SharedMySQLContainerName,
			Image:     SharedMySQLImage,
			Port:      MySQLPort,
			Volume:    SharedMySQLVolume,
			MountPath: MySQLDataMountPath,
			MemoryMB:  sharedServerMemoryMB,
			CPU:       sharedServerCPU,
			// Defaults assume a dedicated host; on a shared VPS they would spend
			// most of the budget on caches.
			Command: []string{
				"--innodb-buffer-pool-size=96M",
				"--performance-schema=OFF",
				"--max-connections=100",
			},
			// mysqld starts as root and calls setgid/setuid to drop to `mysql`;
			// it also chowns its data directory on first start.
			Capabilities: []string{"CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"},
			ReadyProbe: []string{
				"mysqladmin", "--protocol=tcp", "--host=127.0.0.1", "--silent", "ping",
			},
		}
	}

	return sharedServer{
		Name:      SharedPostgresContainerName,
		Image:     SharedPostgresImage,
		Port:      DatabasePort,
		Volume:    SharedPostgresVolume,
		MountPath: PostgresDataMountPath,
		MemoryMB:  sharedServerMemoryMB,
		CPU:       sharedServerCPU,
		ReadyProbe: []string{
			"pg_isready", "--host=127.0.0.1", "--port", strconv.Itoa(DatabasePort),
		},
		// The postgres entrypoint runs as root to chown the data directory and
		// then drops to `postgres`.
		Capabilities: []string{"CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"},
	}
}

// EnsureDatabase provisions the Database's schema and role inside its shared
// server. It is idempotent: a retried create never replaces the schema and only
// re-applies the requested password.
func (m *Manager) EnsureDatabase(ctx context.Context, request DatabaseRequest) (DatabaseState, error) {
	if err := request.validate(); err != nil {
		return DatabaseState{}, err
	}

	engine, _ := normaliseEngine(request.Engine)
	server := sharedServerFor(engine)

	if err := m.ensureSharedServer(ctx, server); err != nil {
		return DatabaseState{}, err
	}

	unlock := m.lockService(databaseLockKey(request.DatabaseID))
	defer unlock()

	// Attaching the shared server to the Project network under `db` is what
	// makes the per-Project connection string resolve without a host port.
	network := projectNetwork(request.ProjectID)
	if err := m.docker.EnsureNetwork(ctx, network); err != nil {
		return DatabaseState{}, fmt.Errorf("could not prepare the Project network: %w", err)
	}

	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return DatabaseState{}, fmt.Errorf(
			"%w: the shared %s server is not running", ErrInvalidDatabase, engine,
		)
	}
	if !info.OnNetwork(network) {
		if err := m.docker.ConnectNetwork(ctx, network, info.ID, DatabaseAlias); err != nil {
			return DatabaseState{}, fmt.Errorf(
				"could not attach the shared server to the Project network: %w", err,
			)
		}
	}

	if err := m.provisionSchema(ctx, engine, request); err != nil {
		return DatabaseState{}, err
	}

	if engine == DatabaseEngineMySQL {
		if err := m.ensurePhpMyAdmin(ctx, request.PhpMyAdminHostname); err != nil {
			return DatabaseState{}, err
		}
	}

	return m.databaseState(ctx, request.DatabaseID, engine, request.StorageLimitMB)
}

// provisionSchema creates the Database and role and grants the role privileges on
// its own schema only. Passwords travel on standard input, never in arguments.
func (m *Manager) provisionSchema(ctx context.Context, engine string, request DatabaseRequest) error {
	server := sharedServerFor(engine)
	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return fmt.Errorf("%w: the shared %s server is not running", ErrInvalidDatabase, engine)
	}

	schema := request.DatabaseName
	role := request.Username

	if engine == DatabaseEngineMySQL {
		statement := strings.Join([]string{
			fmt.Sprintf("CREATE DATABASE IF NOT EXISTS %s;", quoteMySQLIdentifier(schema)),
			fmt.Sprintf(
				"CREATE USER IF NOT EXISTS %s@'%%' IDENTIFIED BY %s;",
				quoteMySQLLiteral(role), quoteMySQLLiteral(request.Password),
			),
			fmt.Sprintf(
				"ALTER USER %s@'%%' IDENTIFIED BY %s;",
				quoteMySQLLiteral(role), quoteMySQLLiteral(request.Password),
			),
			fmt.Sprintf(
				"GRANT ALL PRIVILEGES ON %s.* TO %s@'%%';",
				quoteMySQLIdentifier(schema), quoteMySQLLiteral(role),
			),
			"FLUSH PRIVILEGES;",
		}, "\n") + "\n"

		if _, err := m.docker.Exec(ctx, info.ID, mysqlRootCommand(), statement); err != nil {
			return errors.New(redactSecret(err.Error(), request.Password))
		}

		return nil
	}

	// The role is created or reseated, then the database is created owned by it.
	// CREATE DATABASE cannot run inside a DO block, so it is a guarded statement:
	// `\gexec` only runs it when the database is missing.
	roleStatement := fmt.Sprintf(
		"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = %s) "+
			"THEN CREATE ROLE %s LOGIN PASSWORD %s; "+
			"ELSE ALTER ROLE %s WITH LOGIN PASSWORD %s; END IF; END $$;\n",
		quoteSQLString(role), quoteSQLIdentifier(role), quoteSQLString(request.Password),
		quoteSQLIdentifier(role), quoteSQLString(request.Password),
	)
	if _, err := m.docker.Exec(ctx, info.ID, postgresAdminCommand(), roleStatement); err != nil {
		return errors.New(redactSecret(err.Error(), request.Password))
	}

	databaseStatement := fmt.Sprintf(
		"SELECT 'CREATE DATABASE %s OWNER %s' WHERE NOT EXISTS "+
			"(SELECT FROM pg_database WHERE datname = %s)\\gexec\n",
		quoteSQLIdentifier(schema), quoteSQLIdentifier(role), quoteSQLString(schema),
	)
	if _, err := m.docker.Exec(ctx, info.ID, postgresAdminCommand(), databaseStatement); err != nil {
		return errors.New(redactSecret(err.Error(), request.Password))
	}

	return nil
}

// ensureSharedServer creates the shared server and its Volume, or starts an
// existing one. It never replaces the Volume, so tenant data survives.
func (m *Manager) ensureSharedServer(ctx context.Context, server sharedServer) error {
	if err := m.docker.EnsureNetwork(ctx, "stealth_default"); err != nil {
		return fmt.Errorf("could not prepare the platform network: %w", err)
	}

	if err := m.docker.EnsureVolume(ctx, VolumeSpec{
		Name:   server.Volume,
		SizeMB: MaxDatabaseStorageMB * 20,
		Labels: map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		return fmt.Errorf("could not prepare the shared %s data Volume: %w", server.Name, err)
	}

	if info, err := m.docker.InspectContainer(ctx, server.Name); err == nil {
		if info.Running() {
			return nil
		}
		if err := m.docker.StartContainer(ctx, info.ID); err != nil {
			return fmt.Errorf("could not start the shared %s server: %w", server.Name, err)
		}

		return m.waitSharedServerReady(ctx, server)
	}

	environment := server.Env
	if environment == nil {
		environment = map[string]string{}
	}
	if server.Port == MySQLPort {
		environment["MYSQL_ROOT_PASSWORD"] = m.mysqlRootPassword
	} else {
		environment["POSTGRES_USER"] = sharedPostgresAdmin
		environment["POSTGRES_PASSWORD"] = m.postgresAdminPassword
		environment["POSTGRES_DB"] = "postgres"
	}

	if _, err := m.docker.CreateContainer(ctx, ContainerSpec{
		Name:         server.Name,
		Network:      "stealth_default",
		NetworkAlias: server.Name,
		Image:        server.Image,
		Port:         server.Port,
		CPU:          server.CPU,
		MemoryMB:     server.MemoryMB,
		Command:      server.Command,
		Environment:  environment,
		Volume: &VolumeMount{
			Name:      server.Volume,
			MountPath: server.MountPath,
			SizeMB:    MaxDatabaseStorageMB * 20,
		},
		// Both servers write outside their Volume (socket and lock files).
		ReadOnlyRoot: false,
		Capabilities: server.Capabilities,
		Labels:       map[string]string{LabelType: ResourceTypeDatabase},
	}); err != nil {
		return fmt.Errorf("could not start the shared %s server: %w", server.Name, err)
	}

	return m.waitSharedServerReady(ctx, server)
}

// waitSharedServerReady polls until the server accepts connections. A restarted
// server must finish recovery before a schema can be created.
func (m *Manager) waitSharedServerReady(ctx context.Context, server sharedServer) error {
	deadline := m.clock().Add(databaseReadyTimeout)
	var lastError string

	for {
		info, err := m.docker.InspectContainer(ctx, server.Name)
		if err != nil {
			return fmt.Errorf("%w: the shared %s server disappeared", ErrInvalidDatabase, server.Name)
		}
		if !info.Running() {
			return fmt.Errorf(
				"%w: the shared %s server exited before it became ready",
				ErrInvalidDatabase, server.Name,
			)
		}

		if _, err := m.docker.Exec(ctx, info.ID, server.ReadyProbe, ""); err == nil {
			return nil
		} else {
			lastError = err.Error()
		}

		if !m.clock().Before(deadline) {
			return fmt.Errorf(
				"the shared %s server did not become ready within %s: %s",
				server.Name, databaseReadyTimeout, strings.TrimSpace(lastError),
			)
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("the shared server readiness check was interrupted: %w", ctx.Err())
		case <-time.After(m.pollInterval):
		}
	}
}

// ensurePhpMyAdmin starts or adopts the one phpMyAdmin for the node and programs
// its route. Every MySQL Database signs in through it with its own credentials.
func (m *Manager) ensurePhpMyAdmin(ctx context.Context, hostname string) error {
	hostname = strings.TrimSpace(hostname)
	if hostname == "" {
		return nil
	}

	if err := m.docker.EnsureNetwork(ctx, "stealth_default"); err != nil {
		return fmt.Errorf("could not prepare the platform network: %w", err)
	}

	labels := map[string]string{
		LabelType:     ResourceTypeDatabasePhpMyAdmin,
		LabelHostname: hostname,
		LabelPort:     strconv.Itoa(phpMyAdminPort),
		LabelAlias:    phpMyAdminAlias,
	}
	environment := map[string]string{
		// phpMyAdmin reaches MySQL over the platform network alias and never
		// receives credentials, so the user signs in with the password from its
		// own DATABASE_URL.
		"PMA_HOST":         SharedMySQLContainerName,
		"PMA_PORT":         strconv.Itoa(MySQLPort),
		"PMA_ABSOLUTE_URI": "https://" + hostname + "/",
		"UPLOAD_LIMIT":     strconv.Itoa(phpMyAdminMaxUploadMB) + "M",
	}

	if info, err := m.docker.InspectContainer(ctx, SharedPhpMyAdminContainerName); err == nil {
		// A hostname change makes the absolute URI stale, so the container is
		// replaced rather than reused. It holds no state of its own.
		if info.Labels[LabelHostname] != hostname {
			_ = m.docker.RemoveContainer(ctx, info.ID, true)
		} else {
			if !info.Running() {
				if err := m.docker.StartContainer(ctx, info.ID); err != nil {
					return fmt.Errorf("could not start phpMyAdmin: %w", err)
				}
			}

			return m.router.PutRoute(ctx, Route{
				Hostname: hostname,
				Upstream: upstream(phpMyAdminAlias, phpMyAdminPort),
			})
		}
	}

	containerID, err := m.docker.CreateContainer(ctx, ContainerSpec{
		Name:         SharedPhpMyAdminContainerName,
		Network:      "stealth_default",
		NetworkAlias: phpMyAdminAlias,
		Image:        SharedPhpMyAdminImage,
		Port:         phpMyAdminPort,
		CPU:          0.25,
		MemoryMB:     256,
		// Apache binds port 80 as root and then drops to www-data, which needs
		// exactly these. Everything else stays dropped.
		Capabilities: []string{"CHOWN", "DAC_OVERRIDE", "NET_BIND_SERVICE", "SETGID", "SETUID"},
		Environment:  environment,
		ReadOnlyRoot: false,
		Labels:       labels,
	})
	if err != nil {
		return fmt.Errorf("could not start phpMyAdmin: %w", err)
	}

	if err := m.router.PutRoute(ctx, Route{
		Hostname: hostname,
		Upstream: upstream(phpMyAdminAlias, phpMyAdminPort),
	}); err != nil {
		// A browser client with no route is unreachable and would keep holding
		// memory, so it is removed with the failed attempt.
		_ = m.docker.RemoveContainer(ctx, containerID, true)
		return fmt.Errorf("could not route phpMyAdmin: %w", err)
	}

	return nil
}

// GetDatabase reports a Database's health and storage usage.
func (m *Manager) GetDatabase(
	ctx context.Context,
	databaseID string,
	storageLimitMB int,
) (DatabaseState, error) {
	if strings.TrimSpace(databaseID) == "" {
		return DatabaseState{}, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	}

	return m.databaseState(ctx, databaseID, m.engineForDatabase(ctx, databaseID), storageLimitMB)
}

// RemoveDatabase drops the Database's schema and role. A Database that is
// already gone counts as removed, so a retried cleanup never fails.
func (m *Manager) RemoveDatabase(ctx context.Context, databaseID string) (bool, error) {
	if strings.TrimSpace(databaseID) == "" {
		return false, fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	}

	// A proxy left over from the previous per-Project model must still be
	// revoked, or its listener would outlive the Database.
	if _, err := m.RemoveDatabaseProxy(ctx, databaseID); err != nil {
		return false, err
	}

	unlock := m.lockService(databaseLockKey(databaseID))
	defer unlock()

	// The schema and role names are derived from the id, exactly as the Control
	// Plane derives them, so removal never needs the row.
	if err := m.removeDatabaseObjects(ctx, DatabaseEngineMySQL, databaseID); err != nil {
		return false, err
	}
	if err := m.removeDatabaseObjects(ctx, DatabaseEnginePostgres, databaseID); err != nil {
		return false, err
	}

	return true, nil
}

// removeDatabaseObjects drops the derived schema and role from one server. A
// server that is not running is skipped: the row is already gone from the
// Control Plane, and a later cleanup pass removes what is left.
func (m *Manager) removeDatabaseObjects(ctx context.Context, engine, databaseID string) error {
	server := sharedServerFor(engine)
	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return nil
	}

	schema, role := databaseObjectNames(databaseID)

	if engine == DatabaseEngineMySQL {
		statement := strings.Join([]string{
			fmt.Sprintf("DROP DATABASE IF EXISTS %s;", quoteMySQLIdentifier(schema)),
			fmt.Sprintf("DROP USER IF EXISTS %s@'%%';", quoteMySQLLiteral(role)),
			"FLUSH PRIVILEGES;",
		}, "\n") + "\n"
		if _, err := m.docker.Exec(ctx, info.ID, mysqlRootCommand(), statement); err != nil {
			return fmt.Errorf("could not drop the MySQL Database: %w", err)
		}

		return nil
	}

	// PostgreSQL refuses to drop a role that still owns objects, so the database
	// goes first, then the role.
	statement := fmt.Sprintf(
		"SELECT 'DROP DATABASE IF EXISTS %s' WHERE EXISTS "+
			"(SELECT FROM pg_database WHERE datname = %s)\\gexec\n"+
			"DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = %s) "+
			"THEN DROP ROLE %s; END IF; END $$;\n",
		quoteSQLIdentifier(schema), quoteSQLString(schema),
		quoteSQLString(role), quoteSQLIdentifier(role),
	)
	if _, err := m.docker.Exec(ctx, info.ID, postgresAdminCommand(), statement); err != nil {
		return fmt.Errorf("could not drop the PostgreSQL Database: %w", err)
	}

	return nil
}

// RotateDatabasePassword changes the role's password inside the shared server.
// The new password travels on standard input, never in the arguments.
func (m *Manager) RotateDatabasePassword(
	ctx context.Context,
	request DatabasePasswordRequest,
) (DatabaseState, error) {
	if err := request.validate(); err != nil {
		return DatabaseState{}, err
	}

	engine, _ := normaliseEngine(request.Engine)
	server := sharedServerFor(engine)

	unlock := m.lockService(databaseLockKey(request.DatabaseID))
	defer unlock()

	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return DatabaseState{}, ErrUnknownDatabase
	}

	_, role := databaseObjectNames(request.DatabaseID)

	if engine == DatabaseEngineMySQL {
		statement := fmt.Sprintf(
			"ALTER USER %s@'%%' IDENTIFIED BY %s;\n",
			quoteMySQLLiteral(role), quoteMySQLLiteral(request.Password),
		)
		if _, err := m.docker.Exec(ctx, info.ID, mysqlRootCommand(), statement); err != nil {
			return DatabaseState{}, errors.New(redactSecret(err.Error(), request.Password))
		}
	} else {
		statement := fmt.Sprintf(
			"ALTER ROLE %s WITH PASSWORD %s;\n",
			quoteSQLIdentifier(role), quoteSQLString(request.Password),
		)
		if _, err := m.docker.Exec(ctx, info.ID, postgresAdminCommand(), statement); err != nil {
			return DatabaseState{}, errors.New(redactSecret(err.Error(), request.Password))
		}
	}

	return m.databaseState(ctx, request.DatabaseID, engine, MaxDatabaseStorageMB)
}

// EnforceDatabases locks a Database role whose schema has grown past the storage
// limit, and unlocks it again once it fits. A shared server has no per-database
// quota, so this is the only enforcement point.
func (m *Manager) EnforceDatabases(ctx context.Context) (int, error) {
	locked := 0

	for _, engine := range []string{DatabaseEngineMySQL, DatabaseEnginePostgres} {
		server := sharedServerFor(engine)
		info, err := m.docker.InspectContainer(ctx, server.Name)
		if err != nil || !info.Running() {
			continue
		}

		for _, tenant := range m.tenants(ctx, engine) {
			usage := m.tenantUsage(ctx, engine, tenant.schema)
			over := usage > MaxDatabaseStorageMB
			if err := m.setRoleLocked(ctx, engine, tenant.role, over); err != nil {
				log.Printf("database %s: could not set the role lock: %v", tenant.schema, err)
				continue
			}
			if over {
				log.Printf(
					"database %s uses %d MB, over its %d MB limit; the role is locked",
					tenant.schema, usage, MaxDatabaseStorageMB,
				)
				locked++
			}
		}
	}

	return locked, nil
}

// tenant is one Database found inside a shared server.
type tenant struct {
	schema string
	role   string
}

// tenants lists the Database schemas inside a shared server. Both names are
// derived from the Database id with the same prefix, so the role is recoverable
// from the schema.
func (m *Manager) tenants(ctx context.Context, engine string) []tenant {
	server := sharedServerFor(engine)
	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return nil
	}

	prefix := schemaPrefix()
	var statement string
	if engine == DatabaseEngineMySQL {
		statement = fmt.Sprintf(
			"SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE %s;",
			quoteMySQLLiteral(prefix+"%"),
		)
		output, err := m.docker.Exec(ctx, info.ID, mysqlRootQueryCommand(), statement)
		if err != nil {
			log.Printf("list MySQL Databases: %v", err)
			return nil
		}

		return tenantsFromOutput(output, engine)
	}

	statement = fmt.Sprintf(
		"SELECT datname FROM pg_database WHERE datname LIKE %s;", quoteSQLString(prefix+"%"),
	)
	output, err := m.docker.Exec(ctx, info.ID, postgresAdminQueryCommand(), statement)
	if err != nil {
		log.Printf("list PostgreSQL Databases: %v", err)
		return nil
	}

	return tenantsFromOutput(output, engine)
}

// setRoleLocked locks or unlocks a role so an over-quota tenant cannot keep
// writing. It is idempotent, so a repeated pass converges.
func (m *Manager) setRoleLocked(ctx context.Context, engine, role string, locked bool) error {
	server := sharedServerFor(engine)
	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return nil
	}

	if engine == DatabaseEngineMySQL {
		action := "ACCOUNT UNLOCK"
		if locked {
			action = "ACCOUNT LOCK"
		}
		statement := fmt.Sprintf(
			"ALTER USER %s@'%%' %s;\n", quoteMySQLLiteral(role), action,
		)

		_, err := m.docker.Exec(ctx, info.ID, mysqlRootCommand(), statement)

		return err
	}

	action := "NOLOGIN"
	if !locked {
		action = "LOGIN"
	}
	statement := fmt.Sprintf("ALTER ROLE %s WITH %s;\n", quoteSQLIdentifier(role), action)
	_, err = m.docker.Exec(ctx, info.ID, postgresAdminCommand(), statement)

	return err
}

// databaseState reads the shared server and derives the health the dashboard
// shows.
func (m *Manager) databaseState(
	ctx context.Context,
	databaseID string,
	engine string,
	storageLimitMB int,
) (DatabaseState, error) {
	if storageLimitMB <= 0 || storageLimitMB > MaxDatabaseStorageMB {
		storageLimitMB = MaxDatabaseStorageMB
	}

	server := sharedServerFor(engine)
	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil {
		return DatabaseState{
			DatabaseID:     databaseID,
			Engine:         engine,
			Status:         "absent",
			StorageLimitMB: storageLimitMB,
		}, nil
	}

	usage := m.tenantUsage(ctx, engine, schemaNameFor(databaseID))

	status := "stopped"
	healthy := false
	if info.Running() {
		status = "running"
		healthy = m.serverHealthy(ctx, info, engine)
	} else if info.State == "dead" {
		status = "failed"
	}

	phpMyAdminReady := false
	if engine == DatabaseEngineMySQL {
		if sidecar, err := m.docker.InspectContainer(ctx, SharedPhpMyAdminContainerName); err == nil {
			phpMyAdminReady = sidecar.Running()
		}
	}

	return DatabaseState{
		DatabaseID:      databaseID,
		Engine:          engine,
		Status:          status,
		ContainerID:     info.ID,
		Hostname:        DatabaseAlias,
		StorageLimitMB:  storageLimitMB,
		UsageMB:         usage,
		Healthy:         healthy,
		PhpMyAdminReady: phpMyAdminReady,
		OverQuota:       usage > int64(storageLimitMB),
	}, nil
}

// engineForDatabase reports which shared server holds the Database's schema.
// PostgreSQL is the default when neither server answers.
func (m *Manager) engineForDatabase(ctx context.Context, databaseID string) string {
	schema := schemaNameFor(databaseID)

	if info, err := m.docker.InspectContainer(ctx, SharedMySQLContainerName); err == nil && info.Running() {
		statement := fmt.Sprintf(
			"SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = %s;",
			quoteMySQLLiteral(schema),
		)
		if output, err := m.docker.Exec(ctx, info.ID, mysqlRootQueryCommand(), statement); err == nil {
			if strings.TrimSpace(output) == "1" {
				return DatabaseEngineMySQL
			}
		}
	}

	return DatabaseEnginePostgres
}

// tenantUsage reports how much space a schema uses, in megabytes.
func (m *Manager) tenantUsage(ctx context.Context, engine, schema string) int64 {
	server := sharedServerFor(engine)
	info, err := m.docker.InspectContainer(ctx, server.Name)
	if err != nil || !info.Running() {
		return 0
	}

	if engine == DatabaseEngineMySQL {
		statement := fmt.Sprintf(
			"SELECT COALESCE(ROUND(SUM(data_length + index_length) / 1024 / 1024), 0) "+
				"FROM information_schema.tables WHERE table_schema = %s;",
			quoteMySQLLiteral(schema),
		)
		output, err := m.docker.Exec(ctx, info.ID, mysqlRootQueryCommand(), statement)
		if err != nil {
			return 0
		}
		value, _ := strconv.ParseInt(strings.TrimSpace(output), 10, 64)

		return value
	}

	statement := fmt.Sprintf(
		"SELECT COALESCE(ROUND(pg_database_size(%s) / 1024 / 1024), 0);",
		quoteSQLString(schema),
	)
	output, err := m.docker.Exec(ctx, info.ID, postgresAdminQueryCommand(), statement)
	if err != nil {
		return 0
	}
	value, _ := strconv.ParseInt(strings.TrimSpace(output), 10, 64)

	return value
}

// serverHealthy runs the shared server's readiness probe.
func (m *Manager) serverHealthy(ctx context.Context, info ContainerInfo, engine string) bool {
	server := sharedServerFor(engine)
	_, err := m.docker.Exec(ctx, info.ID, server.ReadyProbe, "")

	return err == nil
}

// reconcileDatabases restarts a shared server whose container outlived an agent
// restart and re-programs the phpMyAdmin route. Docker keeps the per-Project
// network attachments, so they are not re-created here.
func (m *Manager) reconcileDatabases(ctx context.Context) {
	// A shared server outlives the agent, so a restart only needs the browser
	// client's route restored. The servers themselves are left running.
	m.reconcilePhpMyAdmin(ctx)
}

// reconcilePhpMyAdmin re-programs the shared phpMyAdmin route. Caddy is
// configured in memory, so the route is restored after a restart.
func (m *Manager) reconcilePhpMyAdmin(ctx context.Context) {
	container, err := m.docker.InspectContainer(ctx, SharedPhpMyAdminContainerName)
	if err != nil || !container.Running() {
		return
	}
	hostname := container.Labels[LabelHostname]
	if hostname == "" {
		return
	}

	if err := m.router.PutRoute(ctx, Route{
		Hostname: hostname,
		Upstream: upstream(phpMyAdminAlias, phpMyAdminPort),
	}); err != nil {
		log.Printf("reconcile phpMyAdmin: could not restore the route: %v", err)
	}
}

// pruneOrphanPhpMyAdmin removes a phpMyAdmin that is not the shared one, which
// is a leftover from the per-Project model.
func (m *Manager) pruneOrphanPhpMyAdmin(ctx context.Context) (int, error) {
	containers, err := m.docker.ListContainers(ctx, map[string]string{
		LabelType: ResourceTypeDatabasePhpMyAdmin,
	})
	if err != nil {
		return 0, err
	}

	removed := 0
	for _, container := range containers {
		if container.Name == SharedPhpMyAdminContainerName {
			continue
		}
		if hostname := container.Labels[LabelHostname]; hostname != "" {
			// The route must go first, or Caddy would keep dialing a client that
			// no longer exists and answer 502.
			if err := m.router.DeleteRoute(ctx, hostname); err != nil {
				log.Printf("cleanup: could not remove orphan phpMyAdmin route %s: %v", hostname, err)
			}
		}
		if err := m.docker.RemoveContainer(ctx, container.ID, true); err != nil {
			log.Printf("cleanup: could not remove orphan phpMyAdmin %s: %v", container.Name, err)
			continue
		}
		removed++
	}

	return removed, nil
}

// pruneOrphanDatabaseVolumes removes a per-Database Volume left over from the
// per-Project model. The shared data Volumes carry no databaseId, so they are
// never mistaken for an orphan.
func (m *Manager) pruneOrphanDatabaseVolumes(ctx context.Context) (int, error) {
	volumes, err := m.docker.ListVolumes(ctx, map[string]string{LabelType: ResourceTypeDatabase})
	if err != nil {
		return 0, err
	}

	removed := 0
	for _, volume := range volumes {
		if volume.Labels[LabelDatabaseID] == "" {
			continue
		}
		if _, err := m.docker.RemoveVolume(ctx, volume.Name); err != nil {
			log.Printf("cleanup: could not remove orphan Database Volume %s: %v", volume.Name, err)
			continue
		}
		removed++
	}

	return removed, nil
}

// databaseLockKey serialises the operations for one Database.
func databaseLockKey(databaseID string) string {
	return "database:" + databaseID
}

// schemaPrefix is the prefix every Database schema name starts with. It is what
// lets the agent find a Database without asking the Control Plane.
func schemaPrefix() string {
	return "db_"
}

// databaseObjectNames derives the schema and role for a Database id. The Control
// Plane derives the same names with the same formula, so the connection string it
// builds always names the objects the agent creates.
//
// MySQL caps a user name at 32 characters, so both names use a 24 character key
// from the id (96 bits of a UUID), which is short enough for both engines and
// still collision-free in practice.
func databaseObjectNames(databaseID string) (schema string, role string) {
	key := sanitizeID(databaseID)
	key = strings.ReplaceAll(key, "-", "")
	if len(key) > 24 {
		key = key[:24]
	}
	if key == "" {
		key = "tenant"
	}

	return schemaPrefix() + key, "u_" + key
}

// schemaNameFor is the schema half of databaseObjectNames.
func schemaNameFor(databaseID string) string {
	schema, _ := databaseObjectNames(databaseID)

	return schema
}

// mysqlRootCommand runs the mysql client as root inside the shared server. The
// password comes from the container environment, so it never appears in an
// argument.
func mysqlRootCommand() []string {
	return []string{
		"sh", "-c",
		`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root`,
	}
}

// mysqlRootQueryCommand is mysqlRootCommand with an output that is trivial to
// parse: one value per line, no headers.
func mysqlRootQueryCommand() []string {
	return []string{
		"sh", "-c",
		`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --skip-column-names --batch`,
	}
}

// postgresAdminCommand runs psql as the shared server's superuser through the
// container's trusted local socket.
func postgresAdminCommand() []string {
	return []string{
		"psql", "--username", sharedPostgresAdmin, "--dbname", "postgres",
		"--no-psqlrc", "--set", "ON_ERROR_STOP=1",
	}
}

// postgresAdminQueryCommand is postgresAdminCommand with machine-readable output.
func postgresAdminQueryCommand() []string {
	return []string{
		"psql", "--username", sharedPostgresAdmin, "--dbname", "postgres",
		"--no-psqlrc", "--tuples-only", "--no-align",
	}
}

// tenantsFromOutput parses the one-name-per-line output of a tenant listing.
func tenantsFromOutput(output, engine string) []tenant {
	found := make([]tenant, 0)
	seen := make(map[string]bool)

	for _, line := range strings.Split(output, "\n") {
		schema := strings.TrimSpace(line)
		if schema == "" || seen[schema] || !strings.HasPrefix(schema, schemaPrefix()) {
			continue
		}
		seen[schema] = true

		key := strings.TrimPrefix(schema, schemaPrefix())
		found = append(found, tenant{schema: schema, role: "u_" + key})
	}

	return found
}

// validate rejects a request the agent cannot honour.
func (r DatabaseRequest) validate() error {
	if _, err := normaliseEngine(r.Engine); err != nil {
		return err
	}

	switch {
	case strings.TrimSpace(r.DatabaseID) == "":
		return fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	case strings.TrimSpace(r.ProjectID) == "":
		return fmt.Errorf("%w: projectId is required", ErrInvalidDatabase)
	case strings.TrimSpace(r.OrganizationID) == "":
		return fmt.Errorf("%w: organizationId is required", ErrInvalidDatabase)
	case !validPassword(r.Password):
		return fmt.Errorf("%w: password must be between 1 and 256 bytes and contain no NUL", ErrInvalidDatabase)
	case r.StorageLimitMB <= 0 || r.StorageLimitMB > MaxDatabaseStorageMB:
		return fmt.Errorf("%w: storageLimitMb must be between 1 and %d", ErrInvalidDatabase, MaxDatabaseStorageMB)
	}

	// The names reach a SQL statement, so they are re-derived from the id rather
	// than trusted from the request. A mismatch is a caller bug, not a valid
	// request.
	schema, role := databaseObjectNames(r.DatabaseID)
	if r.DatabaseName != "" && r.DatabaseName != schema {
		return fmt.Errorf("%w: databaseName does not match the derived schema", ErrInvalidDatabase)
	}
	if r.Username != "" && r.Username != role {
		return fmt.Errorf("%w: username does not match the derived role", ErrInvalidDatabase)
	}

	return r.validatePhpMyAdmin()
}

// validatePhpMyAdmin enforces the pairing between engine and browser client: a
// MySQL Database reports the shared phpMyAdmin hostname, and PostgreSQL, which
// has no browser client, must not.
func (r DatabaseRequest) validatePhpMyAdmin() error {
	hostname := strings.TrimSpace(r.PhpMyAdminHostname)
	engine, _ := normaliseEngine(r.Engine)

	if engine == DatabaseEngineMySQL {
		if hostname == "" {
			return fmt.Errorf("%w: phpMyAdminHostname is required for MySQL", ErrInvalidDatabase)
		}
		if _, err := normalizeHostname(hostname); err != nil {
			return fmt.Errorf("%w: phpMyAdminHostname is not a valid hostname", ErrInvalidDatabase)
		}

		return nil
	}

	if hostname != "" {
		return fmt.Errorf("%w: phpMyAdminHostname is only valid for MySQL", ErrInvalidDatabase)
	}

	return nil
}

// validate rejects a rotation request the agent cannot honour.
func (r DatabasePasswordRequest) validate() error {
	if _, err := normaliseEngine(r.Engine); err != nil {
		return err
	}

	switch {
	case strings.TrimSpace(r.DatabaseID) == "":
		return fmt.Errorf("%w: databaseId is required", ErrInvalidDatabase)
	case !validPassword(r.Password):
		return fmt.Errorf("%w: password must be between 1 and 256 bytes and contain no NUL", ErrInvalidDatabase)
	}

	return nil
}

func validPassword(value string) bool {
	return value != "" && len(value) <= 256 && !strings.ContainsRune(value, '\x00')
}

// quoteMySQLLiteral quotes a MySQL string literal. MySQL treats a backslash as
// an escape character, so it is doubled as well as the quote.
func quoteMySQLLiteral(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)

	return `'` + strings.ReplaceAll(escaped, `'`, `''`) + `'`
}

// redactSecret replaces a secret in an error message so a tool that echoes its
// input cannot leak it.
func redactSecret(message string, secret string) string {
	if secret == "" {
		return message
	}

	return strings.ReplaceAll(message, secret, "***")
}
