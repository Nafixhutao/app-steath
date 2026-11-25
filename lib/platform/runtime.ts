import { type AgentServiceState } from "../../lib/agent-client.ts";
import { recordAudit } from "./audit.ts";
import { nodeAgent } from "./node-agent.ts";
import { markServiceRunning, markServiceStopped } from "./services.ts";
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
 * never been deployed has no container, which the node reports as `absent`
 * rather than as an error.
 */
export async function getServiceRuntime(
  organizationId: string,
  serviceId: string,
): Promise<ServiceRuntimeState> {
  await requireService(organizationId, serviceId);

  return toRuntimeState(await nodeAgent.readService(serviceId));
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
): Promise<ServiceRuntimeState> {
  await requireService(organizationId, serviceId);

  const runtime = toRuntimeState(await nodeAgent.lifecycle({ serviceId, action }));

  if (runtime.status === "stopped") {
    await markServiceStopped(serviceId);
  } else if (runtime.status === "running") {
    await markServiceRunning(serviceId);
  }

  return runtime;
}

/** Stops a Service without removing its container, so its data is kept. */
export function stopService(
  organizationId: string,
  serviceId: string,
): Promise<ServiceRuntimeState> {
  return runLifecycleAction(organizationId, serviceId, "stop");
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
}): Promise<ServiceRuntimeState> {
  const service = await requireService(input.organizationId, input.serviceId);
  const state = await runLifecycleAction(input.organizationId, input.serviceId, input.action);

  const action =
    input.action === "stop" ? "stopped" : input.action === "start" ? "started" : "restarted";
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
): Promise<ServiceRuntimeState> {
  return runLifecycleAction(organizationId, serviceId, "start");
}

/** Restarts a Service without changing its configuration. */
export function restartService(
  organizationId: string,
  serviceId: string,
): Promise<ServiceRuntimeState> {
  return runLifecycleAction(organizationId, serviceId, "restart");
}

/**
 * Removes the Service container and its route. Called when a Service is deleted so
 * nothing is left orphaned on the node; a failure here must not block the delete,
 * so the caller treats it as best effort.
 */
export async function removeServiceRuntime(serviceId: string): Promise<void> {
  await nodeAgent.removeService(serviceId);
}
