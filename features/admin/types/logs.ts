export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

/** A single structured log line in the explorer. */
export interface LogEntry {
  id: string;
  /** Full ISO timestamp for stable cross-day ordering. */
  timestampIso: string;
  /** Pre-formatted "10:42:18.291". */
  timestamp: string;
  level: LogLevel;
  service: string;
  environment: string;
  message: string;
  /** Optional trailing context on the row, e.g. "200" or "182ms". */
  meta?: string;
  requestId: string;
  traceId: string;
  user?: string;
  agentRun?: string;
  attributes: Record<string, string | number>;
}
