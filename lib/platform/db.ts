import { Pool } from "pg";

/**
 * The single PostgreSQL pool shared by every platform module and the deployment
 * worker. One pool per module would keep a separate connection set open against
 * the same database for no isolation benefit and would risk exhausting
 * `max_connections` as the module count grows.
 */
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
