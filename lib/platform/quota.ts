import { ApiError } from "@/lib/platform/api";

export { QUOTAS } from "@/lib/platform/quota-limits";

/**
 * Raised when creating a resource would exceed a Quota. The API answers with
 * status 409 and names both the limit and the current usage.
 */
export class QuotaExceededError extends ApiError {
  constructor(resource: string, limit: number, usage: number, scope: string) {
    super(
      409,
      "quota_exceeded",
      `${resource} Quota reached: this ${scope} uses ${usage} of ${limit} allowed ${resource}s.`,
      { resource: resource.toLowerCase(), scope: scope.toLowerCase(), limit, usage },
    );
    this.name = "QuotaExceededError";
  }
}
