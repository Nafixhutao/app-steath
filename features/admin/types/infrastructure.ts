import type { MetricPoint } from "./telemetry";

export type HostStatus = "online" | "offline" | "maintenance";

/** A physical/virtual machine running platform services or workers. */
export interface Host {
  id: string;
  name: string;
  status: HostStatus;
  os: string;
  ip: string;
  region: string;
  /** Percent values 0-100 for the resource bars. */
  cpu: number;
  memory: number;
  storage: number;
  /** Absolute capacities the percents resolve against. */
  memoryTotalGb: number;
  storageTotalGb: number;
  uptime: string;
  workers: number;
  jobs: number;
}

/** One resource chart panel on the infrastructure page. */
export interface ResourceSeries {
  id: "cpu" | "memory" | "disk" | "network";
  label: string;
  unit: string;
  tone: "accent" | "info" | "warning" | "muted";
  current: string;
  peak: string;
  average: string;
  data: MetricPoint[];
}
