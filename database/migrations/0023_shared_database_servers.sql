-- Databases now live inside a shared server per engine instead of a container per
-- Database. Each Database is a schema and a role inside that server, reached from
-- the Project network through the `db` alias, so the row no longer describes a
-- container of its own.
--
-- The schema and role names are derived from the row id, exactly as the Node Agent
-- derives them and the Control Plane derives them in `databaseObjectNames()`. The
-- per-Database model gave every Project the names `app`, so a row from that model
-- describes objects that do not exist in the shared server and never will: its
-- data lived in a Volume that is being removed. Those rows are deleted here rather
-- than migrated, because there is nothing to migrate and a stale row would show a
-- Database the user cannot connect to.
--
-- The derivation, in SQL: strip everything but letters and digits, keep 24
-- characters, then prefix with `db_` and `u_`.
DELETE FROM "database"
WHERE
  "databaseName" IS DISTINCT FROM
    'db_' || left(regexp_replace("id", '[^A-Za-z0-9]', '', 'g'), 24)
  OR "username" IS DISTINCT FROM
    'u_' || left(regexp_replace("id", '[^A-Za-z0-9]', '', 'g'), 24);

-- phpMyAdmin is now one browser client for the whole node rather than one sidecar
-- per Database, so every MySQL row carries the same address. The old unique index
-- was written when each Database owned a hostname of its own, and now forbids the
-- second row. Uniqueness is no longer a property of this column.
DROP INDEX IF EXISTS "database_phpMyAdminHostname_key";

-- A shared server listens on one port for every tenant, so a raw TLS listener
-- cannot publish one Database without publishing the others. The public proxy is
-- retired for every engine: the API refuses it now, and this removes the rows the
-- previous model left behind.
DELETE FROM "database_proxy";
