/**
 * Quota limits from the platform spec. Kept free of server imports so both the
 * API and the dashboard can read the same numbers.
 */
export const QUOTAS = {
  projectsPerOrganization: 3,
  servicesPerProject: 2,
  servicesPerOrganization: 5,
  databasesPerProject: 1,
  cpuPerService: 0.5,
  memoryMbPerService: 512,
  volumeMbPerService: 1024,
  databaseStorageMb: 1024,
  // The experiment runs one Build at a time per node, because the worker claims
  // one Build Job at a time.
  buildConcurrencyPerNode: 1,
  // Build and runtime logs are deleted after this many days.
  logRetentionDays: 7,
} as const;
