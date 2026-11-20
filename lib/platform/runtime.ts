import {
  createAgentClient,
  type AgentClient,
  type AgentServiceState,
} from "../../lib/agent-client.ts";
import { ApiError } from "./api-error.ts";
import { recordAudit } from "./audit.ts";
import { markServiceRunning, markServiceStopped } from "./services.ts";
import { nodeConfig } from "./nodes.ts";
import { requireService } from "./ownership.ts";

export type ServiceRuntimeState = {
  serviceId: string;
  status: "running" | "stopped" | "absent";
  containerId: string | null;
  deploymentId: string | null;
  hostname: string | null;
};

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

/**
 * Runs a lifecycle action as a user-driven request: the runtime action itself
 * plus the AuditEvent that records who did it. The Service row is read once and
 * reused for both the ownership check and the audit details, so the routes stay
 * a thin shell and the audit cannot be forgotten. Platform-driven callers
 * (Restore) use `stopService`/`startService` directly, which write no audit.
 */
export async function requestServiceLifecycle(input: {
  organizationId: string;
  userId: string;
  serviceId: string;
  action: "stop" | "start" | "restart";
  options?: { client?: AgentClient };
}): Promise<ServiceRuntimeState> {
  const service = await requireService(input.organizationId, input.serviceId);
  const state = await runLifecycleAction(
    input.organizationId,
    input.serviceId,
    input.action,
    input.options,
  );

  const action = input.action === "stop" ? "stopped" : input.action === "start" ? "started" : "restarted";
  await recordAudit(`service.${action}`, input.organizationId, input.userId, undefined, {
    projectId: service.projectId,
    serviceId: input.serviceId,
    name: service.name,
    hostname: service.platformHostname,
  });

  return state;
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
