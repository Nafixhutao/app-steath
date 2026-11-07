/**
 * Quota limits from the platform spec. Kept free of server imports so both the
 * API and the dashboard can read the same numbers.
 */
export const QUOTAS = {
  projectsPerOrganization: 3,
  servicesPerProject: 2,
  servicesPerOrganization: 5,
  databasesPerProject: 1,
} as const;
