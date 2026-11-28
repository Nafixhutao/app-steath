import { pool } from "./db";

/**
 * Setup state for the Admin Console landing. The Overview shows a short
 * "Get set up" checklist instead of inventing a customer onboarding flow:
 * every step is a real Platform Admin task, and its completed flag comes from
 * the same tables the task writes, so the count can never claim work that was
 * not done.
 */

export type AdminSetupStepId = "abuse" | "email" | "oauth";

export type AdminSetupStep = {
  id: AdminSetupStepId;
  completed: boolean;
};

export type AdminSetupSummary = {
  /** Platform-wide totals shown beside the progress bar. */
  organizations: number;
  services: number;
  /** New + triaged reports; the first step is done when this reaches zero. */
  pendingAbuseReports: number;
  completed: number;
  total: number;
  steps: AdminSetupStep[];
};

/** GitHub and Google credentials can come from the environment instead of the
    Settings panel, so the checklist accepts either source. */
function oauthConfiguredByEnvironment(): boolean {
  return ["GITHUB", "GOOGLE"].some((prefix) => {
    const clientId =
      process.env[`${prefix}_CLIENT_ID`] ?? process.env[`BETTER_AUTH_${prefix}_CLIENT_ID`];
    return Boolean(clientId);
  });
}

async function exists(sql: string): Promise<boolean> {
  const result = await pool.query<{ ok: boolean }>(sql);
  return result.rows[0]?.ok === true;
}

export async function getAdminSetupSummary(): Promise<AdminSetupSummary> {
  const counts = await pool.query<{
    organizations: number;
    services: number;
    pending_abuse: number;
  }>(`
    SELECT
      (SELECT count(*) FROM "organization")::int AS organizations,
      (SELECT count(*) FROM "service")::int AS services,
      (SELECT count(*) FROM "abuse_report" WHERE "status" IN ('new', 'triaged'))::int
        AS pending_abuse
  `);
  const { organizations, services, pending_abuse: pendingAbuseReports } = counts.rows[0];

  // Email and OAuth arrived in later migrations. Guarding with `to_regclass`
  // keeps the Old instance honest ("not configured") instead of failing the
  // whole Overview on a deployment that has not migrated yet.
  const tables = await pool.query<{ email: boolean; oauth: boolean }>(`
    SELECT
      to_regclass('public.email_provider') IS NOT NULL AS email,
      to_regclass('public.oauth_provider_config') IS NOT NULL AS oauth
  `);
  const hasEmailTable = tables.rows[0]?.email === true;
  const hasOAuthTable = tables.rows[0]?.oauth === true;

  const emailConfigured = hasEmailTable
    ? await exists(`
        SELECT EXISTS (
          SELECT 1 FROM "email_provider"
          WHERE "enabled" AND coalesce("apiKeyEncrypted", '') <> ''
        ) AS ok
      `)
    : false;

  const oauthStored = hasOAuthTable
    ? await exists(`SELECT EXISTS (SELECT 1 FROM "oauth_provider_config") AS ok`)
    : false;

  const steps: AdminSetupStep[] = [
    { id: "abuse", completed: pendingAbuseReports === 0 },
    { id: "email", completed: emailConfigured },
    { id: "oauth", completed: oauthStored || oauthConfiguredByEnvironment() },
  ];

  return {
    organizations,
    services,
    pendingAbuseReports,
    completed: steps.filter((step) => step.completed).length,
    total: steps.length,
    steps,
  };
}
