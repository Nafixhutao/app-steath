import createClient from "openapi-fetch";
import type { paths } from "@/contracts/generated/agent";

export function createAgentClient(
  baseUrl: string,
  token: string,
  fetchImpl?: typeof globalThis.fetch,
) {
  return createClient<paths>({
    baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}
