import { Pool } from "pg";
import { ApiError } from "./api-error.ts";
import { MASKED_VALUE, decryptSecret, encryptSecret } from "./secrets.ts";

/**
 * Environment Variables for a Service. The values are secrets: they are sealed
 * with AES-256-GCM before they reach the database, the API only ever returns the
 * full value through an explicit reveal, and the AuditEvents this module is
 * paired with carry the key but never the value.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MAX_KEY_LENGTH = 128;
const MAX_VALUE_LENGTH = 8192;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The platform injects these itself, so a user value would silently shadow it. */
const RESERVED_KEYS = ["DATABASE_URL"];
const RESERVED_PREFIX = "STEALTH_";

export type EnvironmentVariableSummary = {
  id: string;
  serviceId: string;
  key: string;
  /** The masked placeholder, never the value. */
  maskedValue: string;
  createdAt: Date;
  updatedAt: Date;
};

type VariableRow = {
  id: string;
  serviceId: string;
  key: string;
  valueCiphertext: string;
  createdAt: Date;
  updatedAt: Date;
};

const VARIABLE_COLUMNS = `"id", "serviceId", "key", "valueCiphertext", "createdAt", "updatedAt"`;

/**
 * Confirms the Service is visible to the caller's Organization before any read
 * or write, so a Service id from another tenant always answers 404.
 */
async function requireService(organizationId: string, serviceId: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM "service" s JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND s."id" = $2`,
    [organizationId, serviceId],
  );

  if (!result.rowCount) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }
}

/**
 * Environment Variable keys follow the conventional shell name: letters, digits,
 * and underscores, starting with a letter or underscore. Reserved names are
 * rejected case-insensitively, because a lowercase shadow of a platform key is
 * still an attempt to shadow it.
 */
export function normalizeKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_environment_key", "An Environment Variable key is required.");
  }

  const key = value.trim();
  if (key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
    throw new ApiError(
      400,
      "invalid_environment_key",
      "A key may only contain letters, numbers, and underscores, and must start with a letter or underscore.",
    );
  }

  const upper = key.toUpperCase();
  if (RESERVED_KEYS.includes(upper)) {
    throw new ApiError(
      400,
      "reserved_environment_key",
      `${upper} is provided by the platform and cannot be set as an Environment Variable.`,
    );
  }
  if (upper.startsWith(RESERVED_PREFIX)) {
    throw new ApiError(
      400,
      "reserved_environment_key",
      "Keys starting with STEALTH_ are reserved by the platform.",
    );
  }

  return key;
}

/** Values are free-form strings, capped so one variable cannot bloat the row. */
function normalizeValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(
      400,
      "invalid_environment_value",
      "An Environment Variable value must be a string.",
    );
  }

  if (value.length > MAX_VALUE_LENGTH) {
    throw new ApiError(
      400,
      "invalid_environment_value",
      `An Environment Variable value must be at most ${MAX_VALUE_LENGTH} characters.`,
    );
  }

  if (value.includes("\0")) {
    throw new ApiError(
      400,
      "invalid_environment_value",
      "An Environment Variable value must not contain NUL characters.",
    );
  }

  return value;
}

function toSummary(row: VariableRow): EnvironmentVariableSummary {
  return {
    id: row.id,
    serviceId: row.serviceId,
    key: row.key,
    maskedValue: MASKED_VALUE,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Bumps the Service's environment revision. A Deployment records the revision
 * whose values it was started with, so a newer revision is exactly "this Service
 * needs a redeploy".
 */
async function bumpRevision(serviceId: string): Promise<void> {
  await pool.query('UPDATE "service" SET "envRevision" = "envRevision" + 1 WHERE "id" = $1', [
    serviceId,
  ]);
}

async function loadVariable(
  organizationId: string,
  serviceId: string,
  variableId: string,
): Promise<VariableRow> {
  await requireService(organizationId, serviceId);

  const result = await pool.query<VariableRow>(
    `SELECT ${VARIABLE_COLUMNS} FROM "environment_variable"
     WHERE "id" = $1 AND "serviceId" = $2`,
    [variableId, serviceId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "environment_variable_not_found", "Environment Variable not found.");
  }

  return row;
}

/**
 * Reads a Service's variables for the dashboard. The value is always masked
 * here; the full value only leaves this module through an explicit reveal.
 */
export async function listEnvironmentVariables(
  organizationId: string,
  serviceId: string,
): Promise<{ variables: EnvironmentVariableSummary[]; needsRedeploy: boolean }> {
  await requireService(organizationId, serviceId);

  const rows = await pool.query<VariableRow>(
    `SELECT ${VARIABLE_COLUMNS} FROM "environment_variable"
     WHERE "serviceId" = $1 ORDER BY "key"`,
    [serviceId],
  );

  const revision = await pool.query<{ applied: number | null; current: number }>(
    `SELECT s."envRevision" AS "current",
            (SELECT d."envRevision" FROM "deployment" d
             WHERE d."serviceId" = s."id" AND d."status" = 'running'
             ORDER BY d."createdAt" DESC LIMIT 1) AS "applied"
     FROM "service" s WHERE s."id" = $1`,
    [serviceId],
  );

  const current = revision.rows[0]?.current ?? 0;
  const applied = revision.rows[0]?.applied;

  return {
    variables: rows.rows.map(toSummary),
    needsRedeploy: applied !== null && applied < current,
  };
}

export async function createEnvironmentVariable(input: {
  organizationId: string;
  serviceId: string;
  key: unknown;
  value: unknown;
}): Promise<EnvironmentVariableSummary> {
  const key = normalizeKey(input.key);
  const valueCiphertext = encryptSecret(normalizeValue(input.value));

  await requireService(input.organizationId, input.serviceId);

  try {
    const inserted = await pool.query<VariableRow>(
      `INSERT INTO "environment_variable" ("id", "serviceId", "key", "valueCiphertext")
       VALUES (gen_random_uuid()::text, $1, $2, $3)
       RETURNING ${VARIABLE_COLUMNS}`,
      [input.serviceId, key, valueCiphertext],
    );

    await bumpRevision(input.serviceId);

    return toSummary(inserted.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(
        409,
        "environment_variable_exists",
        "A variable with this key already exists on the Service.",
      );
    }
    throw error;
  }
}

/**
 * Updates the key, the value, or both. A ciphertext that is not replaced keeps
 * its sealed value, which still decrypts because the seal does not depend on
 * the key name.
 */
export async function updateEnvironmentVariable(input: {
  organizationId: string;
  serviceId: string;
  variableId: string;
  key?: unknown;
  value?: unknown;
}): Promise<EnvironmentVariableSummary> {
  await loadVariable(input.organizationId, input.serviceId, input.variableId);

  const nextKey = input.key === undefined ? undefined : normalizeKey(input.key);
  const nextValue =
    input.value === undefined ? undefined : encryptSecret(normalizeValue(input.value));

  if (nextKey === undefined && nextValue === undefined) {
    throw new ApiError(
      400,
      "invalid_environment_variable",
      "Provide a key, a value, or both to update.",
    );
  }

  try {
    const updated = await pool.query<VariableRow>(
      `UPDATE "environment_variable"
       SET "key" = COALESCE($3, "key"), "valueCiphertext" = COALESCE($4, "valueCiphertext")
       WHERE "id" = $1 AND "serviceId" = $2
       RETURNING ${VARIABLE_COLUMNS}`,
      [input.variableId, input.serviceId, nextKey ?? null, nextValue ?? null],
    );

    await bumpRevision(input.serviceId);

    return toSummary(updated.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(
        409,
        "environment_variable_exists",
        "A variable with this key already exists on the Service.",
      );
    }
    throw error;
  }
}

/** Deletes one variable. The Service's revision is bumped so the dashboard knows to redeploy. */
export async function deleteEnvironmentVariable(input: {
  organizationId: string;
  serviceId: string;
  variableId: string;
}): Promise<{ id: string }> {
  await loadVariable(input.organizationId, input.serviceId, input.variableId);

  await pool.query('DELETE FROM "environment_variable" WHERE "id" = $1 AND "serviceId" = $2', [
    input.variableId,
    input.serviceId,
  ]);

  await bumpRevision(input.serviceId);

  return { id: input.variableId };
}

/**
 * Returns the full value of one variable. This is the only path out of the
 * database in plaintext, and it exists for an explicit reveal request by an
 * owner or admin.
 */
export async function revealEnvironmentVariable(input: {
  organizationId: string;
  serviceId: string;
  variableId: string;
}): Promise<{ id: string; key: string; value: string }> {
  const row = await loadVariable(input.organizationId, input.serviceId, input.variableId);

  return { id: row.id, key: row.key, value: decryptSecret(row.valueCiphertext) };
}

/**
 * Reads the variables a Deployment should run with, in one statement so the
 * revision and the values are one consistent snapshot. The Node Agent passes
 * these to the container, which is the only place a plaintext value is allowed
 * to travel after the reveal.
 */
export async function loadDeploymentEnvironment(
  serviceId: string,
): Promise<{ revision: number; environment: Array<{ name: string; value: string }> }> {
  const result = await pool.query<{
    envRevision: number;
    variables: Array<{ key: string; ciphertext: string }>;
  }>(
    `SELECT s."envRevision",
            COALESCE(json_agg(json_build_object('key', e."key", 'ciphertext', e."valueCiphertext")
                               ORDER BY e."key") FILTER (WHERE e."id" IS NOT NULL), '[]') AS "variables"
     FROM "service" s
     LEFT JOIN "environment_variable" e ON e."serviceId" = s."id"
     WHERE s."id" = $1
     GROUP BY s."id"`,
    [serviceId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }

  return {
    revision: row.envRevision,
    environment: row.variables.map((variable) => ({
      name: variable.key,
      value: decryptSecret(variable.ciphertext),
    })),
  };
}
