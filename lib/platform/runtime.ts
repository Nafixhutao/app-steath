import { Pool } from "pg";
import { createAgentClient, type AgentClient, type AgentServiceState } from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { markServiceRunning, markServiceStopped } from "./deployments.ts";
import { nodeConfig } from "./nodes.ts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type ServiceRuntimeState = {
  serviceId: string;
  status: "running" | "stopped" | "absent";
  containerId: string | null;
  deploymentId: string | null;
  hostname: string | null;
};

/**
 * Loads the Service and checks it belongs to the caller's Organization. Every
 * runtime action goes through this, so a Service id from another tenant can never
 * be started or stopped.
 */
async function requireService(organizationId: string, serviceId: string) {
  const result = await pool.query<{
    id: string;
    name: string;
    status: string;
    platformHostname: string;
  }>(
    `SELECT s."id", s."name", s."status", s."platformHostname"
     FROM "service" s JOIN "project" p ON p."id" = s."projectId"
     WHERE p."organizationId" = $1 AND s."id" = $2`,
    [organizationId, serviceId],
  );

  const service = result.rows[0];
  if (!service) {
    throw new ApiError(404, "service_not_found", "Service not found.");
  }

  return service;
}

function toRuntimeState(state: AgentServiceState): ServiceRuntimeState {
  return {
    serviceId: state.serviceId,
    status: state.status as ServiceRuntimeState["status"],
    containerId: state.containerId ?? null,
    deploymentId: state.deploymentId ?? null,
    hostname: state.hostname ?? null,
  };
}

/**
 * Reads the runtime state of a Service from the Node Agent. A Service that has
 * never been deployed has no container, which is reported as `absent` rather than
 * treated as an error.
 */
export async function getServiceRuntime(
  organizationId: string,
  serviceId: string,
  options: { client?: AgentClient } = {},
): Promise<ServiceRuntimeState> {
  await requireService(organizationId, serviceId);

  const client = options.client ?? createAgentClient(nodeConfig().baseUrl, nodeConfig().token);
  const response = await client.GET("/v1/services/{serviceId}", {
    params: { path: { serviceId } },
  });

  if (!response.response.ok || !response.data) {
    throw new ApiError(
      502,
      "agent_unavailable",
      `The Node Agent did not report the Service state (${response.response.status}).`,
    );
  }

  return toRuntimeState(response.data);
}

/**
 * Runs a lifecycle action (`stop`, `start`, or `restart`) against the Node Agent
 * and mirrors the result onto the Service row, so the dashboard status matches the
 * container without a second round trip.
 */
async function runLifecycleAction(
  organizationId: string,
  serviceId: string,
  action: "stop" | "start" | "restart",
  options: { client?: AgentClient } = {},
): Promise<ServiceRuntimeState> {
  await requireService(organizationId, serviceId);

  const client = options.client ?? createAgentClient(nodeConfig().baseUrl, nodeConfig().token);

  const response = await (action === "stop"
    ? client.POST("/v1/services/{serviceId}/stop", { params: { path: { serviceId } } })
    : action === "start"
      ? client.POST("/v1/services/{serviceId}/start", { params: { path: { serviceId } } })
      : client.POST("/v1/services/{serviceId}/restart", { params: { path: { serviceId } } }));

  if (response.response.status === 404) {
    throw new ApiError(
      409,
      "service_not_running",
      "This Service has no container on the node yet. Deploy it first.",
    );
  }
  if (!response.response.ok || !response.data) {
    throw new ApiError(
      502,
      "agent_unavailable",
      `The Node Agent could not ${action} the Service (${response.response.status}).`,
    );
  }

  const state = toRuntimeState(response.data);

  if (state.status === "stopped") {
    await markServiceStopped(serviceId);
  } else if (state.status === "running") {
    await markServiceRunning(serviceId);
  }

  return state;
}

/** Stops a Service without removing its container, so its data is kept. */
export function stopService(
  organizationId: string,
  serviceId: string,
  options: { client?: AgentClient } = {},
): Promise<ServiceRuntimeState> {
  return runLifecycleAction(organizationId, serviceId, "stop", options);
}

/** Starts a previously stopped Service. */
export function startService(
  organizationId: string,
  serviceId: string,
  options: { client?: AgentClient } = {},
): Promise<ServiceRuntimeState> {
  return runLifecycleAction(organizationId, serviceId, "start", options);
}

/** Restarts a Service without changing its configuration. */
export function restartService(
  organizationId: string,
  serviceId: string,
  options: { client?: AgentClient } = {},
): Promise<ServiceRuntimeState> {
  return runLifecycleAction(organizationId, serviceId, "restart", options);
}

/**
 * Removes the Service container and its route. Called when a Service is deleted so
 * nothing is left orphaned on the node; a failure here must not block the delete,
 * so the caller treats it as best effort.
 */
export async function removeServiceRuntime(
  serviceId: string,
  options: { client?: AgentClient } = {},
): Promise<void> {
  const client = options.client ?? createAgentClient(nodeConfig().baseUrl, nodeConfig().token);

  await client.DELETE("/v1/services/{serviceId}", {
    params: { path: { serviceId } },
  });
}
