import {
  createAgentClient,
  streamBuildLogs as readBuildLogs,
  streamServiceLogs as readServiceLogs,
  type AgentBuild,
  type AgentBuildLogEvent,
  type AgentBuildRequest,
  type AgentBackupRequest,
  type AgentDeployRequest,
  type AgentDeploymentAbort,
  type AgentHostMetrics,
  type AgentRuntimeLogEvent,
  type AgentScanReport,
  type AgentServiceState,
  type AgentUsage,
} from "../agent-client.ts";
import { ApiError } from "./api-error.ts";
import { nodeConfig } from "./nodes.ts";

/**
 * The Control Plane's one seam to the Node Agent.
 *
 * Before this module, eleven platform modules, one route handler, and the worker
 * each built their own client and read the response envelope by hand, so one seam
 * grew six error conventions: a thrown 502 here, a swallowed `console.error`
 * there, a `"failed"` string somewhere else. Every operation below names what the
 * Control Plane wants from the node, not the verb and path that happen to
 * implement it, and each owns its own `ApiError` code and sentence. Client
 * construction, the ok/status check, the mapping to `ApiError`, and the two
 * binary endpoints live here, so no other module builds an Agent URL, an auth
 * header, or a status-code branch.
 *
 * The interface stays wide on purpose: each operation is used at least once, and
 * a caller that had to reach past it would be back to speaking HTTP. What is
 * narrow is what a caller must know — an input and a domain value, or a thrown
 * `ApiError` whose sentence is already fit to show the user. The one exception is
 * the Deployment operations, which return the node's envelope because their
 * caller records the status number on a row instead of answering a request.
 */

/** What the user should be told when an operation cannot reach the node. */
type AgentFailure = {
  /** `ApiError` code, e.g. `database_provisioning_failed`. */
  code: string;
  /** One sentence without a trailing period; the module appends the status. */
  message: string;
};

/** The shape every generated Agent call resolves to. */
type AgentResult<T> = {
  data?: T;
  response: { ok: boolean; status: number };
};

/** The generated client, named once so the signatures below stay readable. */
type Client = ReturnType<typeof createAgentClient>;

/** How a Service's runtime answered a lifecycle request. */
export type AgentLifecycle = "stop" | "start" | "restart";

/** What the node knows about one Database container. */
export type AgentDatabaseState = {
  status: string;
  healthy: boolean;
  usageMb: number;
  overQuota?: boolean;
  phpMyAdminReady?: boolean;
};

/** What the node knows about one Volume. */
export type AgentVolumeState = { usageMb: number; exists: boolean };

/**
 * The outcome of asking Caddy to serve a hostname. `missing` means the Service
 * has no container, `not_running` means it has one that is not serving, and
 * `failed` is the node refusing for any other reason.
 */
export type AgentRouteResult = "ok" | "missing" | "not_running" | "failed";

export const nodeAgent = {
  // ---------------------------------------------------------------- Databases

  /**
   * Reads the Database container. `null` means the node has no such container,
   * which the dashboard shows as "not created yet" rather than as a failure.
   */
  readDatabase(input: {
    databaseId: string;
    storageLimitMb: number;
  }): Promise<AgentDatabaseState | null> {
    return missingAsNull(
      {
        code: "database_unreadable",
        message: `The Node Agent did not report the state of Database ${input.databaseId}`,
      },
      (client) =>
        client.GET("/v1/databases/{databaseId}", {
          params: {
            path: { databaseId: input.databaseId },
            query: { storageLimitMb: input.storageLimitMb },
          },
        }),
    );
  },

  /** Creates or updates the Database schema and role, returning the node status. */
  async provisionDatabase(input: {
    databaseId: string;
    projectId: string;
    organizationId: string;
    engine: "postgres" | "mysql";
    phpMyAdminHostname?: string;
    databaseName: string;
    username: string;
    password: string;
    storageLimitMb: number;
  }): Promise<string> {
    const state = await call(
      {
        code: "database_provisioning_failed",
        message: "The Node Agent could not start the Database. Try again when the node is healthy",
      },
      (client) =>
        client.PUT("/v1/databases/{databaseId}", {
          params: { path: { databaseId: input.databaseId } },
          body: {
            databaseId: input.databaseId,
            projectId: input.projectId,
            organizationId: input.organizationId,
            engine: input.engine,
            ...(input.phpMyAdminHostname ? { phpMyAdminHostname: input.phpMyAdminHostname } : {}),
            databaseName: input.databaseName,
            username: input.username,
            password: input.password,
            storageLimitMb: input.storageLimitMb,
          },
        }),
    );

    return state.status;
  },

  /** Drops the schema and role. A Database the node already lost is not an error. */
  removeDatabase(databaseId: string): Promise<void> {
    return run(
      {
        code: "database_removal_failed",
        message: "The Node Agent could not remove the Database. Try again when the node is healthy",
      },
      (client) =>
        client.DELETE("/v1/databases/{databaseId}", {
          params: { path: { databaseId } },
        }),
      { allowMissing: true },
    );
  },

  /**
   * Changes the role's password inside the running cluster. A Database that is
   * not running has no role to change yet, which is the user's next step rather
   * than a node failure.
   */
  rotateDatabasePassword(input: {
    databaseId: string;
    engine: "postgres" | "mysql";
    password: string;
  }): Promise<void> {
    return run(
      {
        code: "database_rotation_failed",
        message:
          "The Node Agent could not rotate the credentials. Try again when the node is healthy",
      },
      (client) =>
        client.POST("/v1/databases/{databaseId}/rotate", {
          params: { path: { databaseId: input.databaseId } },
          body: { engine: input.engine, password: input.password },
        }),
      {
        explain: (status) =>
          status === 404
            ? new ApiError(
                409,
                "database_not_running",
                "Start the Database before rotating its credentials.",
              )
            : null,
      },
    );
  },

  /** Tears down a leftover public listener. A Database that never had one is fine. */
  disableDatabaseProxy(databaseId: string): Promise<void> {
    return run(
      {
        code: "database_proxy_disable_failed",
        message:
          "The Node Agent could not disable the public proxy. Try again when the node is healthy",
      },
      (client) =>
        client.DELETE("/v1/databases/{databaseId}/proxy", {
          params: { path: { databaseId } },
        }),
      { allowMissing: true },
    );
  },

  // ------------------------------------------------------------------ Volumes

  /** Reads a Volume's usage. `null` means the node has no such Volume. */
  readVolume(input: { name: string; sizeMb: number }): Promise<AgentVolumeState | null> {
    return missingAsNull(
      {
        code: "volume_unreadable",
        message: `The Node Agent did not report the usage of Volume ${input.name}`,
      },
      (client) =>
        client.GET("/v1/volumes/{name}", {
          params: { path: { name: input.name }, query: { sizeMb: input.sizeMb } },
        }),
    );
  },

  /**
   * Removes the Volume. The node refuses while a container still mounts it; that
   * is a step the user can take, not a node failure.
   */
  removeVolume(name: string): Promise<void> {
    return run(
      {
        code: "volume_removal_failed",
        message: "The Node Agent could not remove the Volume. Try again when the node is healthy",
      },
      (client) => client.DELETE("/v1/volumes/{name}", { params: { path: { name } } }),
      {
        explain: (status) =>
          status === 409
            ? new ApiError(409, "volume_in_use", "Stop the Service before deleting its Volume.")
            : null,
      },
    );
  },

  // ----------------------------------------------------------------- Services

  /** Reads a Service container. A Service the node does not know answers 502. */
  readService(serviceId: string): Promise<AgentServiceState> {
    return call(
      { code: "agent_unavailable", message: "The Node Agent did not report the Service state" },
      (client) => client.GET("/v1/services/{serviceId}", { params: { path: { serviceId } } }),
    );
  },

  /**
   * Runs a lifecycle action. A Service with no container is reported as
   * `service_not_running`, because deploying it is the user's next step.
   */
  lifecycle(input: { serviceId: string; action: AgentLifecycle }): Promise<AgentServiceState> {
    return call(
      {
        code: "agent_unavailable",
        message: `The Node Agent could not ${input.action} the Service`,
      },
      (client) =>
        input.action === "stop"
          ? client.POST("/v1/services/{serviceId}/stop", {
              params: { path: { serviceId: input.serviceId } },
            })
          : input.action === "start"
            ? client.POST("/v1/services/{serviceId}/start", {
                params: { path: { serviceId: input.serviceId } },
              })
            : client.POST("/v1/services/{serviceId}/restart", {
                params: { path: { serviceId: input.serviceId } },
              }),
      {
        explain: (status) =>
          status === 404
            ? new ApiError(
                409,
                "service_not_running",
                "This Service has no container on the node yet. Deploy it first.",
              )
            : null,
      },
    );
  },

  /** Removes the container and its route. A Service never deployed is not an error. */
  removeService(serviceId: string): Promise<void> {
    return run(
      {
        code: "agent_unavailable",
        message: "The Node Agent could not remove the Service container",
      },
      (client) => client.DELETE("/v1/services/{serviceId}", { params: { path: { serviceId } } }),
      { allowMissing: true },
    );
  },

  /** Stops the container and drops its route, keeping its data. */
  suspendService(serviceId: string): Promise<void> {
    return run(
      { code: "agent_unavailable", message: "The Node Agent could not suspend the Service" },
      (client) =>
        client.POST("/v1/services/{serviceId}/suspend", { params: { path: { serviceId } } }),
      { allowMissing: true },
    );
  },

  /** Restores a suspended container, optionally starting it again. */
  unsuspendService(input: { serviceId: string; restore: boolean }): Promise<void> {
    return run(
      { code: "agent_unavailable", message: "The Node Agent could not restore the Service" },
      (client) =>
        client.POST("/v1/services/{serviceId}/unsuspend", {
          params: { path: { serviceId: input.serviceId } },
          body: { restore: input.restore },
        }),
      { allowMissing: true },
    );
  },

  /**
   * Points a hostname at a Service container. The three refusals are part of the
   * answer rather than errors, because the caller retries once the Service is
   * deployed and running.
   */
  async routeHostname(input: { serviceId: string; hostname: string }): Promise<AgentRouteResult> {
    const failure: AgentFailure = {
      code: "custom_domain_route_failed",
      message: `The Node Agent could not route ${input.hostname}`,
    };

    try {
      const result = await attempt((client) =>
        client.PUT("/v1/services/{serviceId}/hostnames/{hostname}", {
          params: { path: { serviceId: input.serviceId, hostname: input.hostname } },
        }),
      );

      if (result.response.ok) return "ok";
      if (result.response.status === 404) return "missing";
      if (result.response.status === 409) return "not_running";

      console.error(`${failure.message} (${result.response.status}).`);

      return "failed";
    } catch (error) {
      console.error(`${failure.message}. The node did not answer.`, error);

      return "failed";
    }
  },

  /** Drops a hostname route. A route the node never had is not an error. */
  removeHostnameRoute(input: { serviceId: string; hostname: string }): Promise<void> {
    return run(
      {
        code: "custom_domain_route_failed",
        message: `The Node Agent could not remove the route for ${input.hostname}`,
      },
      (client) =>
        client.DELETE("/v1/services/{serviceId}/hostnames/{hostname}", {
          params: { path: { serviceId: input.serviceId, hostname: input.hostname } },
        }),
      { allowMissing: true },
    );
  },

  // -------------------------------------------------------------- Deployments

  /**
   * The four Deployment operations answer with the node's envelope instead of
   * throwing, because their caller is the Deployment state machine: a refusal
   * becomes a recorded failure on the Deployment row, not a 502 for a user who is
   * no longer watching. It needs the status number for that message, so the
   * envelope is the honest return shape here rather than a throw to unwrap.
   */
  startDeployment(
    body: AgentDeployRequest,
  ): Promise<
    AgentResult<{ deploymentId: string; serviceId: string; status: string; error?: string }>
  > {
    return attempt((client) => client.POST("/v1/deployments", { body }));
  },

  startBuild(body: AgentBuildRequest): Promise<AgentResult<AgentBuild>> {
    return attempt((client) => client.POST("/v1/builds", { body }));
  },

  /** Reads a finished Build. A missing answer is a failure the caller records. */
  readBuild(buildId: string): Promise<AgentResult<AgentBuild>> {
    return attempt((client) =>
      client.GET("/v1/builds/{buildId}", { params: { path: { buildId } } }),
    );
  },

  /** Cancels a Build the user gave up on, removing what it produced. */
  cancelBuild(input: {
    deploymentId: string;
    serviceId: string;
    imageRef: string;
  }): Promise<AgentResult<AgentDeploymentAbort>> {
    return attempt((client) =>
      client.POST("/v1/deployments/{deploymentId}/cancel", {
        params: { path: { deploymentId: input.deploymentId } },
        body: { serviceId: input.serviceId, imageRef: input.imageRef },
      }),
    );
  },

  /** Follows a Build's log until it ends, which is also the completion signal. */
  async streamBuildLogs(
    input: { buildId: string; after: number },
    onEvent: (event: AgentBuildLogEvent) => Promise<void> | void,
  ): Promise<void> {
    await readBuildLogs(agentClient(), input.buildId, input.after, onEvent);
  },

  /**
   * Follows a Service container's log. The stream stays open while the container
   * runs, so the caller aborts it when the reader goes away.
   */
  async streamServiceLogs(
    input: { serviceId: string; tail: number; signal?: AbortSignal },
    onEvent: (event: AgentRuntimeLogEvent) => Promise<void> | void,
  ): Promise<void> {
    await readServiceLogs(agentClient(), input.serviceId, input.tail, onEvent, input.signal);
  },

  // ------------------------------------------------------- Backups & Restores

  /** Asks the node to dump the Backup target and stage the artifact. */
  createBackup(body: AgentBackupRequest): Promise<void> {
    return run({ code: "backup_failed", message: "The Node Agent rejected the Backup" }, (client) =>
      client.POST("/v1/backups", { body }),
    );
  },

  /**
   * Downloads the staged artifact. The generated client types the body as a
   * string, so this is one of two operations that speaks raw `fetch`; keeping it
   * here means no other module builds an Agent URL or an auth header.
   */
  async downloadBackup(backupId: string): Promise<Buffer> {
    const { baseUrl, token } = nodeConfig();
    const response = await fetch(`${baseUrl}/v1/backups/${encodeURIComponent(backupId)}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw refused(
        {
          code: "backup_download_failed",
          message: `The Node Agent could not hand over Backup ${backupId}`,
        },
        response.status,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  },

  /** Removes the staged artifact. The durable copy is already in storage. */
  discardBackup(backupId: string): Promise<void> {
    return run(
      {
        code: "backup_cleanup_failed",
        message: `The Node Agent could not discard the staged Backup ${backupId}`,
      },
      (client) => client.DELETE("/v1/backups/{backupId}", { params: { path: { backupId } } }),
      { allowMissing: true },
    );
  },

  /**
   * Sends a Backup artifact to the node, which loads it into the Restore target.
   * The node answers 200 only after the data work succeeded, so this resolving is
   * the completion signal.
   */
  async sendRestore(input: {
    restoreId: string;
    targetType: "database" | "volume";
    targetId: string;
    bytes: Buffer;
  }): Promise<void> {
    const { baseUrl, token } = nodeConfig();
    const query = new URLSearchParams({
      targetType: input.targetType,
      targetId: input.targetId,
    });

    const response = await fetch(
      `${baseUrl}/v1/restores/${encodeURIComponent(input.restoreId)}?${query}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
        },
        // Copy into a plain Uint8Array so fetch accepts the bytes as a body.
        body: new Uint8Array(input.bytes),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ApiError(
        502,
        "restore_failed",
        `The Node Agent could not restore the Backup (${response.status})${detail ? `: ${detail}` : ""}.`,
      );
    }
  },

  // ------------------------------------------------------- Node-wide readings

  /** Reads the node's whole usage in one request. */
  readUsage(): Promise<AgentUsage> {
    return call(
      { code: "usage_unreadable", message: "Could not read usage from the Node Agent" },
      (client) => client.GET("/v1/usage"),
    );
  },

  /**
   * Reads one node's host sample. `baseUrl` comes from the node row, not from
   * `AGENT_BASE_URL`, so the pass keeps working when a second node reports in.
   */
  readHostMetrics(input: { baseUrl: string; name: string }): Promise<AgentHostMetrics> {
    return call(
      {
        code: "host_metrics_unreadable",
        message: `[worker] could not read host metrics from ${input.name}`,
      },
      (client) => client.GET("/v1/host-metrics"),
      { baseUrl: input.baseUrl },
    );
  },

  /** Runs the image scanners and returns their findings. */
  scanImage(input: { deploymentId: string; imageRef: string }): Promise<AgentScanReport> {
    return call(
      { code: "scan_failed", message: "The Node Agent could not scan the image" },
      (client) => client.POST("/v1/scans", { body: input }),
    );
  },
};

/**
 * The typed Agent client for the configured node, built once per base URL and
 * token. It stays private: callers name an operation above instead of issuing a
 * request, so a path change never reaches twelve modules.
 */
let cached: { key: string; client: Client } | null = null;

function agentClient(baseUrl?: string): Client {
  const config = nodeConfig();
  const resolved = baseUrl ?? config.baseUrl;
  const key = `${resolved}\u0000${config.token}`;

  if (cached?.key !== key) {
    cached = { key, client: createAgentClient(resolved, config.token) };
  }

  return cached.client;
}

/** One request, before any status interpretation. */
function attempt<T>(operation: (client: Client) => Promise<AgentResult<T>>, baseUrl?: string) {
  return operation(agentClient(baseUrl));
}

/**
 * Runs one operation that must answer with a payload. An unreachable node and a
 * refusal both surface as the same 502, because the caller cannot do anything
 * different about either. `explain` turns a status the caller understands into
 * its own error.
 */
async function call<T>(
  failure: AgentFailure,
  operation: (client: Client) => Promise<AgentResult<T>>,
  options: { explain?: (status: number) => ApiError | null; baseUrl?: string } = {},
): Promise<T> {
  const result = await guard(failure, () => attempt(operation, options.baseUrl));

  if (!result.response.ok) {
    const explained = options.explain?.(result.response.status);
    if (explained) {
      console.error(explained.message);
      throw explained;
    }
  }

  if (!result.response.ok || result.data === undefined || result.data === null) {
    throw refused(failure, result.response.status);
  }

  return result.data;
}

/** Same as `call`, but a 404 answers `null` instead of throwing. */
async function missingAsNull<T>(
  failure: AgentFailure,
  operation: (client: Client) => Promise<AgentResult<T>>,
): Promise<T | null> {
  const result = await guard(failure, () => attempt(operation));

  if (result.response.status === 404) return null;
  if (!result.response.ok || result.data === undefined || result.data === null) {
    throw refused(failure, result.response.status);
  }

  return result.data;
}

/**
 * Runs one operation whose success is "the node did not complain". `allowMissing`
 * treats a 404 as success, which is what makes teardown idempotent: the object is
 * gone either way.
 */
async function run(
  failure: AgentFailure,
  operation: (client: Client) => Promise<AgentResult<unknown>>,
  options: { allowMissing?: boolean; explain?: (status: number) => ApiError | null } = {},
): Promise<void> {
  const result = await guard(failure, () => attempt(operation));

  if (result.response.ok) return;

  const status = result.response.status;
  if (options.allowMissing && status === 404) return;

  const explained = options.explain?.(status);
  if (explained) {
    console.error(explained.message);
    throw explained;
  }

  throw refused(failure, status);
}

/**
 * A refusal already carries the sentence the caller chose; anything else is the
 * node not answering at all, which is worth one log line because the response
 * cannot say why.
 */
async function guard<T>(failure: AgentFailure, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) throw error;

    console.error(failure.message, error);

    throw new ApiError(502, failure.code, `${failure.message}. The node did not answer.`);
  }
}

function refused(failure: AgentFailure, status: number): ApiError {
  const message = `${failure.message} (${status}).`;
  console.error(message);

  return new ApiError(502, failure.code, message);
}
