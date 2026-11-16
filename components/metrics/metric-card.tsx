"use client";

/**
 * Shared host metric building blocks. The same card, bar, and sparkline render
 * the node's own CPU, memory, and storage on the admin page, so a future
 * customer-facing usage view can reuse them with a different data source.
 */

const WARNING_RATIO = 0.75;
const DANGER_RATIO = 0.9;

export type UsageLevel = "ok" | "warning" | "danger";

/** Maps a used/total ratio to the semantic state the rest of the UI uses. */
export function usageLevel(used: number, total: number): UsageLevel {
  if (total <= 0) {
    return "ok";
  }
  const ratio = used / total;
  if (ratio >= DANGER_RATIO) {
    return "danger";
  }
  if (ratio >= WARNING_RATIO) {
    return "warning";
  }
  return "ok";
}

export function levelClass(level: UsageLevel): string {
  return `metric-level is-${level}`;
}

export function mebibytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} TiB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} GiB`;
  }
  return `${Math.round(value)} MiB`;
}

export function percent(used: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((used / total) * 100)}%`;
}

/**
 * MetricCard shows one headline value with its share of the whole and a spark
 * of recent history. The bar only appears for ratios, not for rates like CPU
 * percent alone, via the optional used/total pair.
 */
export function MetricCard({
  label,
  value,
  detail,
  used,
  total,
  history,
}: {
  label: string;
  value: string;
  detail?: string;
  used?: number;
  total?: number;
  history?: number[];
}) {
  const hasRatio = used !== undefined && total !== undefined;
  const level = hasRatio ? usageLevel(used ?? 0, total ?? 0) : "ok";

  return (
    <article className="metric-card">
      <header className="metric-card-heading">
        <h3>{label}</h3>
        {hasRatio ? <span className={levelClass(level)}>{percent(used ?? 0, total ?? 0)}</span> : null}
      </header>
      <p className="metric-card-value">{value}</p>
      {detail ? <p className="metric-card-detail">{detail}</p> : null}
      {hasRatio ? (
        <div
          className={`metric-bar is-${level}`}
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(((used ?? 0) / Math.max(total ?? 1, 1)) * 100)}
        >
          <span style={{ width: `${Math.min(100, ((used ?? 0) / Math.max(total ?? 1, 1)) * 100)}%` }} />
        </div>
      ) : null}
      {history && history.length > 1 ? <Sparkline values={history} /> : null}
    </article>
  );
}

/**
 * Sparkline draws the recent values as a single SVG polyline. It scales to the
 * data itself so a quiet node still shows its shape rather than a flat line at
 * the bottom, and the viewBox keeps it crisp at any width.
 */
export function Sparkline({ values }: { values: number[] }) {
  const width = 240;
  const height = 40;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 0.0001);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="metric-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Recent history"
    >
      <polyline points={points} />
    </svg>
  );
}
