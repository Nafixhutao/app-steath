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
export type AgentDeployRequest = components["schemas"]["DeployRequest"];
export type AgentDeployment = components["schemas"]["Deployment"];
export type AgentServiceState = components["schemas"]["ServiceState"];
export type AgentRuntimeLogEvent = components["schemas"]["RuntimeLogEvent"];
export type AgentDeploymentAbort = components["schemas"]["DeploymentAbort"];

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

  await readNdjson(response.data, onEvent);
}

/**
 * Follows the runtime log of a Service container. The stream stays open while the
 * container runs, so callers must abort the request when the reader goes away.
 */
export async function streamServiceLogs(
  client: AgentClient,
  serviceId: string,
  tail: number,
  onEvent: (event: AgentRuntimeLogEvent) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await client.GET("/v1/services/{serviceId}/logs", {
    params: { path: { serviceId }, query: { tail } },
    parseAs: "stream",
    ...(signal ? { signal } : {}),
  });

  if (!response.response.ok || !response.data) {
    throw new Error(`The Node Agent rejected the runtime log stream (${response.response.status}).`);
  }

  await readNdjson(response.data, onEvent);
}

/**
 * Parses newline-delimited JSON as it arrives, so the caller sees each event
 * without waiting for the stream to close.
 */
async function readNdjson<T>(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: T) => Promise<void> | void,
): Promise<void> {
  const reader = stream.getReader();
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
        await onEvent(JSON.parse(line) as T);
      }
      newline = buffer.indexOf("\n");
    }
  }

  const remainder = buffer.trim();
  if (remainder) {
    await onEvent(JSON.parse(remainder) as T);
  }
}
