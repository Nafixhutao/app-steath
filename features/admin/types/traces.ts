export type SpanStatus = "success" | "error";

/** One span inside a trace waterfall; `start`/`duration` are milliseconds. */
export interface TraceSpan {
  id: string;
  name: string;
  service: string;
  start: number;
  duration: number;
  status: SpanStatus;
}

export type TraceStatus = "success" | "error";

/** A request trace: root operation plus its nested span list. */
export interface Trace {
  id: string;
  service: string;
  operation: string;
  duration: number;
  status: TraceStatus;
  timestamp: string;
  spanList: TraceSpan[];
}
