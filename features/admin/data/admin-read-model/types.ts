import type { components } from "@/lib/admin/api-schema";
import type { Incident } from "../../types/incidents";

export type AdminOperation = components["schemas"]["AdminOperation"];
export type AdminOperationSummary =
  components["schemas"]["AdminOperationSummary"];
export type AdminErrorGroup = components["schemas"]["AdminErrorGroup"];
export type AdminTraceSpan = components["schemas"]["AdminTraceSpan"];
export type AdminLog = components["schemas"]["AdminLog"];
export type AdminHostMetricsSnapshot =
  components["schemas"]["AdminHostMetricsSnapshot"];
export type AdminAgentCatalog = components["schemas"]["AgentCatalogResponse"];
export type AdminStatusPage = components["schemas"]["AdminStatusPage"];
export type AdminStatusPageComponent =
  components["schemas"]["AdminStatusPageComponent"];

export type AdminReadStatus = "pending" | "error" | "ready";

export interface AdminReadState<T> {
  status: AdminReadStatus;
  data: T;
  error: string | null;
  isFetching: boolean;
  refetch: () => void;
}

export type AdminTimeRange = "1h" | "6h" | "24h" | "7d";
export type HostTimeRange = "5m" | "15m" | "1h";

export interface RunProjection {
  id: string;
  agent: string;
  project: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  durationMs: number;
  startedAt: string;
  error: string | null;
}

export interface ProviderProjection {
  id: string;
  name: string;
  models: string[];
}

export interface ProviderReadModel {
  providers: ProviderProjection[];
  execution: AdminAgentCatalog["execution"] | null;
}

export interface UsageProjection {
  summary: AdminOperationSummary | null;
  totalRecent: number;
  byKind: Array<{ kind: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  recent: AdminOperation[];
}

export interface StatusProjection {
  name: string;
  description: string;
  isPublic: boolean;
  updatedAt: string;
  components: AdminStatusPageComponent[];
  incidents: Incident[];
  degraded: boolean;
}

export interface ExecutionQueueProjection {
  summary: AdminOperationSummary | null;
  items: AdminOperation[];
  queued: number;
  running: number;
  failed: number;
}
