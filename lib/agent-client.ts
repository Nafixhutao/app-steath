import createClient from "openapi-fetch";
import type { components, paths } from "../contracts/generated/agent.d.ts";

/**
 * Typed client for the Node Agent. Every request and response shape comes from
 * the generated OpenAPI contract, so a contract change breaks compilation here
 * instead of silently diverging from the Go server.
 */
export type AgentBuild = components["schemas"]["Build"];
export type AgentBuildRequest = components["schemas"]["BuildRequest"];
export type AgentBuildLogEvent = components["schemas"]["BuildLogEvent"];
export type AgentNodeInfo = components["schemas"]["NodeInfo"];

export type AgentClient = ReturnType<typeof createAgentClient>;

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

/**
 * Reads the NDJSON Build log stream and reports every event as it arrives. The
 * stream closes when the Build finishes, so this resolves once the log is done.
 */
export async function streamBuildLogs(
  client: AgentClient,
  buildId: string,
  after: number,
  onEvent: (event: AgentBuildLogEvent) => Promise<void> | void,
): Promise<void> {
  const response = await client.GET("/v1/builds/{buildId}/logs", {
    params: { path: { buildId }, query: { after } },
    parseAs: "stream",
  });

  if (!response.response.ok || !response.data) {
    throw new Error(`The Node Agent rejected the Build log stream (${response.response.status}).`);
  }

  const reader = response.data.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        await onEvent(JSON.parse(line) as AgentBuildLogEvent);
      }
      newline = buffer.indexOf("\n");
    }
  }

  const remainder = buffer.trim();
  if (remainder) {
    await onEvent(JSON.parse(remainder) as AgentBuildLogEvent);
  }
}
