"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PixelSkeleton } from "@/components/ui/pixel-skeleton";
import { cn } from "@/lib/utils";

/** Icon chip identical to the host MetricCard's: same border, surface, size,
    and stroke weight, so the tile rows read as one grid. */
export function InfraIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
      <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

/** One metric tile: icon + label row, then the value row, then children. */
export function InfraTile({
  icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--projects-border)] bg-[#141416] p-2.5 sm:p-3.5",
        className,
      )}
    >
      <header className="flex items-center gap-1.5 sm:gap-2.5">
        <InfraIcon icon={icon} />
        <h4 className="m-0 truncate text-[11.5px] font-normal leading-4 text-[var(--projects-text)]/90 sm:text-[13.5px] sm:leading-5">
          {label}
        </h4>
      </header>
      {children}
    </article>
  );
}

/** Big metric number with an optional smaller unit beside it. */
export function TileValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="admin-tnum m-0 flex min-w-0 items-baseline gap-1 sm:gap-1.5">
      <span className="truncate text-[21px] font-bold leading-none tracking-[-0.02em] text-[var(--projects-text)] sm:text-[26px]">
        {value}
      </span>
      {unit && (
        <span className="shrink-0 text-[12.5px] font-semibold text-[var(--projects-text)]/80 sm:text-[15px]">
          {unit}
        </span>
      )}
    </p>
  );
}

/** Thin usage bar. Load bars (utilization) flip to warning/danger as they
    fill; `higherIsBetter` bars (hit rate, ratio) stay green however full. */
export function TileBar({
  percent,
  higherIsBetter = false,
}: {
  percent: number;
  higherIsBetter?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--projects-progress-track)]"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          higherIsBetter
            ? "bg-[var(--projects-accent)]"
            : clamped >= 85
              ? "bg-[var(--projects-danger)]"
              : clamped >= 65
                ? "bg-[var(--projects-warning)]"
                : "bg-[var(--projects-accent)]",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export type DeltaTone = "good" | "bad" | "neutral";

/** Percent change between two values; `goodWhenUp` decides the arrow color. */
export function deltaParts(
  now: number,
  before: number,
  goodWhenUp: boolean,
): { text: string; tone: DeltaTone; rising: boolean } | undefined {
  if (before <= 0) return undefined;
  const percent = ((now - before) / before) * 100;
  if (Math.abs(percent) < 0.05) return undefined;
  const rising = percent >= 0;
  const tone: DeltaTone = rising
    ? goodWhenUp
      ? "good"
      : "bad"
    : goodWhenUp
      ? "bad"
      : "good";
  return { text: `${Math.abs(Math.round(percent * 10) / 10)}%`, tone, rising };
}

/** "↓ 35% (vs last hour)" change note. The window suffix shows the full
    phrase on sm+ screens and a compact "(1h)" form on phones so the note
    never truncates inside a narrow tile. */
export function Delta({
  parts,
  suffix = "vs last hour",
  shortSuffix,
}: {
  parts: { text: string; tone: DeltaTone; rising: boolean } | undefined;
  suffix?: string;
  shortSuffix?: string;
}) {
  if (!parts) return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 text-[12px] font-semibold sm:text-[13px]",
        parts.tone === "good"
          ? "text-[var(--projects-accent)]"
          : parts.tone === "bad"
            ? "text-[var(--projects-danger)]"
            : "text-[var(--projects-muted)]",
      )}
    >
      {parts.rising ? (
        <ArrowUpRight
          size={13}
          strokeWidth={2.2}
          className="shrink-0 sm:hidden"
          aria-hidden="true"
        />
      ) : (
        <ArrowDownRight
          size={13}
          strokeWidth={2.2}
          className="shrink-0 sm:hidden"
          aria-hidden="true"
        />
      )}
      {parts.rising ? (
        <ArrowUpRight
          size={14}
          strokeWidth={2.2}
          className="hidden shrink-0 sm:block"
          aria-hidden="true"
        />
      ) : (
        <ArrowDownRight
          size={14}
          strokeWidth={2.2}
          className="hidden shrink-0 sm:block"
          aria-hidden="true"
        />
      )}
      <span className="shrink-0">{parts.text}</span>
      <span className="min-w-0 truncate font-normal text-[var(--projects-muted)]">
        <span className="hidden sm:inline">({suffix})</span>
        <span className="sm:hidden">({shortSuffix ?? suffix})</span>
      </span>
    </span>
  );
}

/** The green "● Healthy" pill from the reference design. */
export function HealthPill({
  tone,
  label,
}: {
  tone: "success" | "danger" | "neutral";
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold sm:gap-2 sm:px-3.5 sm:py-1.5 sm:text-[13.5px]",
        tone === "success" &&
          "border-[var(--projects-accent)]/35 bg-[var(--projects-accent)]/10 text-[var(--projects-accent)]",
        tone === "danger" &&
          "border-[var(--projects-danger)]/35 bg-[var(--projects-danger)]/10 text-[var(--projects-danger)]",
        tone === "neutral" &&
          "border-[var(--projects-border)] bg-white/[0.04] text-[var(--projects-muted)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full bg-current sm:size-2.5",
          tone !== "neutral" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {label}
    </span>
  );
}

/** "PostgreSQL 17.2 (Debian ...)" → "PostgreSQL 17"; "8.2.0" → "Redis 8.2". */
export function versionLabel(serverVersion: string, product: string): string {
  const match = /(\d+(?:\.\d+)?)/.exec(serverVersion);
  return match ? `${product} ${match[1]}` : product;
}

export function uptimeLabel(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function windowSuffix(windowMinutes: number): string {
  if (windowMinutes >= 60) {
    const hours = Math.round(windowMinutes / 60);
    return `vs last ${hours} hour${hours >= 2 ? "s" : ""}`;
  }
  return `vs last ${windowMinutes} minutes`;
}

/** Compact phone form of the delta window: "1h", "15m", "5m". */
export function windowSuffixShort(windowMinutes: number): string {
  if (windowMinutes >= 60) {
    const hours = Math.round(windowMinutes / 60);
    return `${hours}h`;
  }
  return `${windowMinutes}m`;
}

/**
 * Shared first-load skeleton for the infra panels: the pixel skeleton inside
 * a tile-shaped card, mirroring MetricCardsSkeleton. `count` tiles render in
 * the same grid the live panel uses.
 */
export function InfraPanelSkeleton({ count }: { count: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-2 pb-1 sm:gap-3 lg:grid-cols-4"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-2.5 rounded-lg border border-[var(--projects-border)] bg-[#141416] p-3 sm:p-3.5"
        >
          <div className="flex items-center gap-2 sm:gap-2.5">
            <PixelSkeleton className="size-6 rounded-md" />
            <PixelSkeleton className="h-3.5 w-20" />
          </div>
          <PixelSkeleton className="h-6 w-24" />
          <PixelSkeleton className="h-[18px] w-full" />
        </div>
      ))}
    </div>
  );
}
