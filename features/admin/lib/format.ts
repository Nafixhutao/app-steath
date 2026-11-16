/** Format milliseconds as a compact human duration: 482 ms / 1.2 s / 8.4 s. */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

/** 12841 → "12.8k" */
export function formatCompactNumber(value: number): string {
  if (value >= 1000) return `${(Math.round(value / 100) / 10).toFixed(1)}k`;
  return String(value);
}
