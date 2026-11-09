import { randomBytes } from "node:crypto";
import { lookup, resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { Pool } from "pg";
import { createAgentClient } from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { nodeConfig } from "./nodes.ts";
import { getPlatformDomain } from "./platform-domain.ts";

/**
 * A Custom Domain is the one optional hostname a Service may serve next to its
 * Platform Subdomain. It stays pending until the owner publishes a TXT record
 * proving control and points DNS at the platform. Only an active domain is
 * allowed through Caddy's on-demand certificate check, so a failed Custom Domain
 * never affects the Platform Subdomain.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type CustomDomainStatus = "pending" | "active" | "failed";
export type CustomDomainCertificateStatus = "pending" | "issued" | "failed";

export type CustomDomainInstructions = {
  /** Publish this TXT record to prove control of the hostname. */
  txt: { name: string; value: string };
  /** Point an A record here when the platform has a known public IP. */
  a: { name: string; value: string | null };
  /** Or point a CNAME at the platform domain. */
  cname: { name: string; value: string };
};

export type CustomDomainSummary = {
  id: string;
  serviceId: string;
  hostname: string;
  status: CustomDomainStatus;
  certificateStatus: CustomDomainCertificateStatus;
  verifiedAt: string | null;
  lastError: string | null;
  instructions: CustomDomainInstructions;
  createdAt: string;
  updatedAt: string;
};

type ServiceRow = {
  serviceId: string;
  projectId: string;
  platformHostname: string;
  containerPort: number;
  status: string;
};

type CustomDomainRow = {
  id: string;
  serviceId: string;
  hostname: string;
  status: CustomDomainStatus;
  verificationToken: string;
  certificateStatus: CustomDomainCertificateStatus;
  verifiedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const DOMAIN_COLUMNS = `"id", "serviceId", "hostname", "status", "verificationToken",
  "certificateStatus", "verifiedAt", "lastError", "createdAt", "updatedAt"`;

const MAX_HOSTNAME_LENGTH = 253;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A resolver seam so tests can prove verification without real DNS. */
export type DnsResolver = {
  resolveTxt(name: string): Promise<string[][]>;
  lookup(name: string): Promise<Array<{ address: string; family: number }>>;
};

const defaultResolver: DnsResolver = {
  resolveTxt: (name) => resolveTxt(name),
  lookup: (name) => lookup(name, { all: true, verbatim: true }),
};

/**
 * The resolver verification uses. It is swappable so tests can prove the TXT and
 * address checks without publishing real DNS records, and so a future private
 * resolver can be plugged in without changing the verification logic.
 */
let activeResolver: DnsResolver = defaultResolver;

export function setDnsResolver(resolver: DnsResolver | null): void {
  activeResolver = resolver ?? defaultResolver;
}

/**
 * Accepts only a bare DNS hostname. Schemes, ports, paths, wildcards, and IP
 * literals are rejected because a Custom Domain is a name the user owns, not a
 * URL or an address.
 */
export function normalizeCustomDomainHostname(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "invalid_hostname", "A hostname is required.");
  }

  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    hostname.length > MAX_HOSTNAME_LENGTH ||
    hostname.includes("://") ||
    /[\s/:@*?#]/.test(hostname) ||
    isIP(hostname) !== 0
  ) {
    throw new ApiError(
      400,
      "invalid_hostname",
      "Enter a bare hostname such as app.example.com, without a scheme or port.",
    );
  }

  const labels = hostname.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL_PATTERN.test(label))) {
    throw new ApiError(400, "invalid_hostname", "The hostname is not a valid domain name.");
  }

  return hostname;
}

function instructionsFor(row: CustomDomainRow): CustomDomainInstructions {
  return {
    txt: {
      name: `_stealth-verify.${row.hostname}`,
      value: row.verificationToken,
    },
    a: {
      name: row.hostname,
      value: process.env.PLATFORM_IP?.trim() || null,
    },
    cname: {
      name: row.hostname,
      value: getPlatformDomain(),
    },
  };
}

function toSummary(row: CustomDomainRow): CustomDomainSummary {
  return {
    id: row.id,
    serviceId: row.serviceId,
    hostname: row.hostname,
    status: row.status,
    certificateStatus: row.certificateStatus,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    lastError: row.lastError,
    instructions: instructionsFor(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireService(organizationId: string, serviceId: string): Promise<ServiceRow> {
  const result = await pool.query<ServiceRow>(
    `SELECT s."id" AS "serviceId", s."projectId", s."platformHostname",
            s."containerPort", s."status"
     FROM "service" s
     JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND s."id" = $2`,
    [organizationId, serviceId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }

  return row;
}

async function loadDomain(serviceId: string): Promise<CustomDomainRow | null> {
  const result = await pool.query<CustomDomainRow>(
    `SELECT ${DOMAIN_COLUMNS} FROM "custom_domain" WHERE "serviceId" = $1`,
    [serviceId],
  );

  return result.rows[0] ?? null;
}

async function loadDomainById(id: string): Promise<CustomDomainRow | null> {
  const result = await pool.query<CustomDomainRow>(
    `SELECT ${DOMAIN_COLUMNS} FROM "custom_domain" WHERE "id" = $1`,
    [id],
  );

  return result.rows[0] ?? null;
}

/**
 * Rejects a hostname another Service already uses, including Platform
 * Subdomains. The unique constraint on `custom_domain.hostname` is the final
 * guard, but this check produces a useful error instead of a constraint name.
 */
async function assertHostnameAvailable(hostname: string, serviceId: string): Promise<void> {
  const taken = await pool.query(
    `SELECT 1 FROM "custom_domain" WHERE lower("hostname") = $1 AND "serviceId" <> $2
     UNION ALL
     SELECT 1 FROM "service" WHERE lower("platformHostname") = $1
     LIMIT 1`,
    [hostname, serviceId],
  );

  if (taken.rowCount) {
    throw new ApiError(
      409,
      "hostname_taken",
      "That hostname is already used by another Service.",
    );
  }
}

export async function getServiceCustomDomain(
  organizationId: string,
  serviceId: string,
): Promise<CustomDomainSummary | null> {
  const service = await requireService(organizationId, serviceId);
  const row = await loadDomain(service.serviceId);

  return row ? toSummary(row) : null;
}

export async function addServiceCustomDomain(input: {
  organizationId: string;
  serviceId: string;
  hostname: unknown;
}): Promise<CustomDomainSummary> {
  const service = await requireService(input.organizationId, input.serviceId);
  const hostname = normalizeCustomDomainHostname(input.hostname);

  if (await loadDomain(service.serviceId)) {
    throw new ApiError(
      409,
      "custom_domain_exists",
      "This Service already has a Custom Domain. Delete it before adding another.",
    );
  }
  await assertHostnameAvailable(hostname, service.serviceId);

  try {
    const result = await pool.query<CustomDomainRow>(
      `INSERT INTO "custom_domain" ("id", "serviceId", "hostname", "verificationToken")
       VALUES (gen_random_uuid()::text, $1, $2, $3)
       RETURNING ${DOMAIN_COLUMNS}`,
      [service.serviceId, hostname, randomBytes(16).toString("hex")],
    );

    return toSummary(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const constraint = (error as { constraint?: string }).constraint;
      if (constraint === "custom_domain_serviceId_key") {
        throw new ApiError(
          409,
          "custom_domain_exists",
          "This Service already has a Custom Domain.",
        );
      }
      throw new ApiError(
        409,
        "hostname_taken",
        "That hostname is already used by another Service.",
      );
    }
    throw error;
  }
}

/**
 * Verifies the TXT record and DNS resolution, then asks the Node Agent to route
 * the hostname. A failed verification is recorded on the row and returned, not
 * thrown, so the dashboard can show the reason and the Platform Subdomain keeps
 * serving.
 */
export async function verifyServiceCustomDomain(input: {
  organizationId: string;
  serviceId: string;
  resolver?: DnsResolver;
}): Promise<CustomDomainSummary> {
  const service = await requireService(input.organizationId, input.serviceId);
  const row = await loadDomain(service.serviceId);
  if (!row) {
    throw new ApiError(404, "custom_domain_not_found", "This Service has no Custom Domain.");
  }

  const resolver = input.resolver ?? activeResolver;
  const failure = await checkDns(row, resolver);
  if (failure) {
    return persistVerification(row, {
      status: "failed",
      certificateStatus: "failed",
      lastError: failure,
      verifiedAt: null,
    });
  }

  const routed = await routeCustomDomain(service.serviceId, row.hostname);
  if (routed === "missing" || routed === "not_running") {
    // DNS is correct but there is nothing to route to yet. Leave the row pending
    // so the owner can deploy and retry without publishing a different token.
    throw new ApiError(
      409,
      "service_not_running",
      "Deploy the Service before verifying its Custom Domain.",
    );
  }
  if (routed === "failed") {
    return persistVerification(row, {
      status: "failed",
      certificateStatus: "failed",
      lastError: "The Node Agent could not route the hostname. Try again when the node is healthy.",
      verifiedAt: null,
    });
  }

  return persistVerification(row, {
    status: "active",
    certificateStatus: "issued",
    lastError: null,
    verifiedAt: new Date(),
  });
}

async function checkDns(row: CustomDomainRow, resolver: DnsResolver): Promise<string | null> {
  const txtName = `_stealth-verify.${row.hostname}`;
  let records: string[][];
  try {
    records = await resolver.resolveTxt(txtName);
  } catch {
    return `The TXT record ${txtName} could not be resolved.`;
  }

  const values = records.map((chunks) => chunks.join(""));
  if (!values.includes(row.verificationToken)) {
    return `The TXT record ${txtName} does not contain the verification value.`;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver.lookup(row.hostname);
  } catch {
    return `The hostname ${row.hostname} does not resolve to the platform.`;
  }

  if (addresses.length === 0) {
    return `The hostname ${row.hostname} does not resolve to the platform.`;
  }

  const expected = process.env.PLATFORM_IP?.trim();
  if (expected && !addresses.some((entry) => entry.address === expected)) {
    return `The hostname ${row.hostname} does not point at the platform (${expected}).`;
  }

  return null;
}

async function persistVerification(
  row: CustomDomainRow,
  update: {
    status: CustomDomainStatus;
    certificateStatus: CustomDomainCertificateStatus;
    lastError: string | null;
    verifiedAt: Date | null;
  },
): Promise<CustomDomainSummary> {
  const result = await pool.query<CustomDomainRow>(
    `UPDATE "custom_domain"
     SET "status" = $2, "certificateStatus" = $3, "lastError" = $4, "verifiedAt" = $5
     WHERE "id" = $1
     RETURNING ${DOMAIN_COLUMNS}`,
    [row.id, update.status, update.certificateStatus, update.lastError, update.verifiedAt],
  );

  return toSummary(result.rows[0]);
}

export async function deleteServiceCustomDomain(input: {
  organizationId: string;
  serviceId: string;
}): Promise<{ id: string; serviceId: string; hostname: string }> {
  const service = await requireService(input.organizationId, input.serviceId);
  const row = await loadDomain(service.serviceId);
  if (!row) {
    throw new ApiError(404, "custom_domain_not_found", "This Service has no Custom Domain.");
  }

  // The route must be gone before the row is, otherwise Caddy could keep serving
  // a cached certificate for a domain the user deleted. A node that cannot be
  // reached fails the delete, so the user can retry instead of leaving an orphan
  // route behind.
  await removeCustomDomainRoute(service.serviceId, row.hostname);

  await pool.query('DELETE FROM "custom_domain" WHERE "id" = $1', [row.id]);

  return { id: row.id, serviceId: service.serviceId, hostname: row.hostname };
}

/**
 * Called by Caddy's `ask` endpoint. Only a Platform Subdomain or an active
 * Custom Domain may receive a certificate, so the platform cannot be used to
 * issue certificates for arbitrary names.
 */
export async function isCertificateHostnameAllowed(hostname: string): Promise<boolean> {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) {
    return false;
  }

  const result = await pool.query(
    `SELECT 1 FROM "service" WHERE lower("platformHostname") = $1
     UNION ALL
     SELECT 1 FROM "custom_domain" WHERE lower("hostname") = $1 AND "status" = 'active'
     LIMIT 1`,
    [normalized],
  );

  return (result.rowCount ?? 0) > 0;
}

type RouteResult = "ok" | "missing" | "not_running" | "failed";

async function routeCustomDomain(serviceId: string, hostname: string): Promise<RouteResult> {
  try {
    const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
    const response = await client.PUT("/v1/services/{serviceId}/hostnames/{hostname}", {
      params: { path: { serviceId, hostname } },
    });

    if (response.response.status === 404) {
      return "missing";
    }
    if (response.response.status === 409) {
      return "not_running";
    }

    return response.response.ok ? "ok" : "failed";
  } catch (error) {
    console.error(`could not route Custom Domain ${hostname}`, error);
    return "failed";
  }
}

async function removeCustomDomainRoute(serviceId: string, hostname: string): Promise<void> {
  const client = createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
  const response = await client.DELETE("/v1/services/{serviceId}/hostnames/{hostname}", {
    params: { path: { serviceId, hostname } },
  });

  if (!response.response.ok && response.response.status !== 404) {
    throw new Error(`The Node Agent answered ${response.response.status}.`);
  }
}

/** Re-exported so the Service delete path can clean up its route. */
export async function removeServiceCustomDomainOnNode(
  serviceId: string,
  hostname: string,
): Promise<void> {
  await removeCustomDomainRoute(serviceId, hostname);
}

export { loadDomainById };
