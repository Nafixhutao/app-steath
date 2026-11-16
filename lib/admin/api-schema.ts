/**
 * Admin API wire types — the exact schemas the ported Forge console consumes
 * (from stealth-forge's generated `api/generated/schema`). Every endpoint in
 * `/api/admin/*` answers in these shapes so the feature components render
 * unmodified.
 */

export type AdminComponentStatus = { name: string; status: string };

export type AdminTelemetryStatus = { status: string };

export type AdminHTTPOverview = {
  request_rate: number;
  error_rate: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  sample_count: number;
};

export type AdminOperationSummary = {
  active_deployments: number;
  queued_jobs: number;
  running_jobs: number;
  failed_jobs: number;
};

export type AdminOperation = {
  id: string;
  kind: string;
  name: string;
  project_id?: string | null;
  project_name?: string | null;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms: number;
  error?: string | null;
  created_at: string;
};

export type AdminOperationsResponse = { items: AdminOperation[] };

export type AdminRecentDeployment = {
  id: string;
  app_name: string;
  version: number;
  status: string;
  build_status: string;
  created_at: string;
};

export type AdminOverviewResponse = {
  instance_status: string;
  checked_at: string;
  components: AdminComponentStatus[];
  telemetry: AdminTelemetryStatus;
  http?: AdminHTTPOverview;
  operations?: AdminOperationSummary;
  recent_deployments?: AdminRecentDeployment[];
};

export type AdminHostMetricsSample = {
  timestamp: string;
  cpu_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  network_rx_bytes_per_sec: number;
  network_tx_bytes_per_sec: number;
};

export type AdminHostMetricsSnapshot = {
  current: AdminHostMetricsSample;
  history: AdminHostMetricsSample[];
};

export type AdminDBMetricsSample = {
  timestamp: string;
  connections: number;
  max_connections: number;
  active_queries: number;
  cache_hit_ratio_known: boolean;
  cache_hit_ratio_percent: number;
  transactions_per_sec: number;
  query_latency_ms: number;
  replication_standbys: number;
  database_size_bytes: number;
  uptime_seconds: number;
};

export type AdminDBMetricsSnapshot = {
  current: AdminDBMetricsSample;
  history: AdminDBMetricsSample[];
  server_version: string;
  reachable: boolean;
};

export type AdminRedisMetricsSample = {
  timestamp: string;
  connections: number;
  max_clients: number;
  ops_per_sec: number;
  hit_rate_known: boolean;
  hit_rate_percent: number;
  memory_used_bytes: number;
  memory_max_bytes: number;
  keys: number;
  uptime_seconds: number;
};

export type AdminRedisMetricsSnapshot = {
  current: AdminRedisMetricsSample;
  history: AdminRedisMetricsSample[];
  server_version: string;
  reachable: boolean;
};

export type AdminAPIMetrics = {
  goroutines: number;
  heap_alloc_bytes: number;
  heap_objects: number;
  stack_bytes: number;
  sys_bytes: number;
  gc_runs: number;
  last_gc_pause_ms: number;
  go_version: string;
  process_uptime_seconds: number;
};

export type AdminAccount = {
  id: string;
  email: string;
  email_verified: boolean;
  plan: string;
  created_at: string;
  providers: ("github" | "google")[];
  avatar_url?: string;
  display_name?: string;
  last_sign_in_at?: string;
  last_sign_in_method?: "password" | "github" | "google";
};

export type AdminAccountsResponse = { items: AdminAccount[] };

/** The plan values the Forge generated enum names; paas only stores "free". */
export type AdminAccountPlan = "free" | "go" | "plus" | "pro";

export type UpdateAdminAccountPlanRequest = { plan: AdminAccountPlan };

export type AdminLog = {
  timestamp: string;
  trace_id?: string;
  span_id?: string;
  level?: string;
  service: string;
  message: string;
  attributes?: Record<string, string>;
  resource_attributes?: Record<string, string>;
};

export type AdminLogsResponse = { items: AdminLog[] };

export type AdminTraceSpan = {
  timestamp: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  kind: string;
  service: string;
  duration_ns: number;
  status: string;
  status_message?: string;
  attributes?: Record<string, string>;
  resource_attributes?: Record<string, string>;
};

export type AdminTracesResponse = { items: AdminTraceSpan[] };

export type AdminErrorGroup = {
  fingerprint: string;
  service: string;
  error_type: string;
  message: string;
  status: "open" | "acknowledged" | "resolved" | "ignored";
  first_seen: string;
  last_seen: string;
  occurrence_count: number;
  trace_id?: string;
};

export type AdminErrorGroupsResponse = { items: AdminErrorGroup[] };

export type UpdateAdminErrorGroupStatusRequest = {
  status: "open" | "acknowledged" | "resolved" | "ignored";
};

export type AdminIncidentEvent = {
  id: string;
  incident_id: string;
  kind: string;
  message: string;
  actor_account_id?: string;
  created_at: string;
};

export type AdminIncident = {
  id: string;
  title: string;
  severity: "info" | "warning" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  services: string[];
  started_at: string;
  resolved_at?: string;
  created_by_account_id?: string;
  events: AdminIncidentEvent[];
  created_at: string;
  updated_at: string;
};

export type AdminIncidentsResponse = { items: AdminIncident[] };

export type CreateAdminIncidentRequest = {
  title: string;
  severity: "info" | "warning" | "critical";
  status?: "investigating" | "identified" | "monitoring" | "resolved";
  services: string[];
  message?: string;
};

export type AdminStatusPageComponent = {
  name: string;
  status: string;
  description?: string;
  url?: string;
};

export type AdminStatusPage = {
  name: string;
  description: string;
  is_public: boolean;
  components: AdminStatusPageComponent[];
  published_incidents: string[];
  updated_at: string;
};

export type AdminAgentProvider = { id: string; name: string; models: string[] };

/** Mirrors the Forge generated enums the catalog types index into. */
export type AgentCatalogExecutionMode = "queue_only";

export type AgentCatalogExecution = {
  mode: AgentCatalogExecutionMode;
  ready: boolean;
  message: string;
};

/** Same shape as Forge's `AgentCatalogResponse`. */
export type AdminAgentCatalog = {
  providers: AdminAgentProvider[];
  roles: string[];
  tools: string[];
  execution: AgentCatalogExecution;
};

export type OAuthProviderName = "github" | "google";

export type AdminOAuthProvider = {
  provider: OAuthProviderName;
  configured: boolean;
  client_id?: string;
  callback_url: string;
  source: "database" | "environment" | "none";
  updated_at?: string;
};

export type AdminOAuthProvidersResponse = {
  providers: AdminOAuthProvider[];
};

export type UpdateAdminOAuthProviderRequest = {
  client_id: string;
  client_secret: string;
};

/** The error-group lifecycle statuses, as the Forge generated enums named them. */
export const AdminErrorGroupStatus = {
  open: "open",
  acknowledged: "acknowledged",
  resolved: "resolved",
  ignored: "ignored",
} as const;

export type AdminErrorGroupStatus =
  (typeof AdminErrorGroupStatus)[keyof typeof AdminErrorGroupStatus];

export const UpdateAdminErrorGroupStatusRequestStatus =
  AdminErrorGroupStatus;

export type UpdateAdminErrorGroupStatusRequestStatus =
  AdminErrorGroupStatus;

/** The status-page component states, as the Forge generated enum named them. */
export const AdminStatusPageComponentStatus = {
  operational: "operational",
  degraded: "degraded",
  partial_outage: "partial_outage",
  major_outage: "major_outage",
  maintenance: "maintenance",
} as const;

export type AdminStatusPageComponentStatus =
  (typeof AdminStatusPageComponentStatus)[keyof typeof AdminStatusPageComponentStatus];

/** The openapi-fetch style namespace the ported Forge components index into. */
export type components = {
  schemas: {
    AdminComponentStatus: AdminComponentStatus;
    AdminHTTPOverview: AdminHTTPOverview;
    AdminOperationSummary: AdminOperationSummary;
    AdminOperation: AdminOperation;
    AdminOperationsResponse: AdminOperationsResponse;
    AdminRecentDeployment: AdminRecentDeployment;
    AdminOverviewResponse: AdminOverviewResponse;
    AdminHostMetricsSample: AdminHostMetricsSample;
    AdminHostMetricsSnapshot: AdminHostMetricsSnapshot;
    AdminDBMetricsSample: AdminDBMetricsSample;
    AdminDBMetricsSnapshot: AdminDBMetricsSnapshot;
    AdminRedisMetricsSample: AdminRedisMetricsSample;
    AdminRedisMetricsSnapshot: AdminRedisMetricsSnapshot;
    AdminAPIMetrics: AdminAPIMetrics;
    AdminAccount: AdminAccount;
    AdminAccountsResponse: AdminAccountsResponse;
    UpdateAdminAccountPlanRequest: UpdateAdminAccountPlanRequest;
    AdminLog: AdminLog;
    AdminLogsResponse: AdminLogsResponse;
    AdminTraceSpan: AdminTraceSpan;
    AdminTracesResponse: AdminTracesResponse;
    AdminErrorGroup: AdminErrorGroup;
    AdminErrorGroupsResponse: AdminErrorGroupsResponse;
    UpdateAdminErrorGroupStatusRequest: UpdateAdminErrorGroupStatusRequest;
    AdminIncident: AdminIncident;
    AdminIncidentEvent: AdminIncidentEvent;
    AdminIncidentsResponse: AdminIncidentsResponse;
    CreateAdminIncidentRequest: CreateAdminIncidentRequest;
    AdminStatusPage: AdminStatusPage;
    AdminStatusPageComponent: AdminStatusPageComponent;
    AdminAgentProvider: AdminAgentProvider;
    AgentCatalogExecutionMode: AgentCatalogExecutionMode;
    AgentCatalogExecution: AgentCatalogExecution;
    /** The Forge generated name for the agent catalog payload. */
    AgentCatalogResponse: AdminAgentCatalog;
    AdminAgentCatalog: AdminAgentCatalog;
    AdminOAuthProvider: AdminOAuthProvider;
    AdminOAuthProvidersResponse: AdminOAuthProvidersResponse;
    UpdateAdminOAuthProviderRequest: UpdateAdminOAuthProviderRequest;
  };
};
