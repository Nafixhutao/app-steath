"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bordered, near-black content panel — the base surface of every section. */
export function AdminPanel({
  children,
  className,
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  /** Remove the default inner padding (full-bleed tables, log stream). */
  flush?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]",
        !flush && "p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Section heading row: small uppercase title with an optional right slot. */
export function AdminPanelHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5",
        subtitle ? "mb-3" : "mb-2",
        className,
      )}
    >
      <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--projects-muted)]">
        {title}
      </h2>
      {right ? (
        <div className="ml-auto flex items-center gap-2">{right}</div>
      ) : null}
      {subtitle ? (
        <p className="m-0 w-full text-[12px] leading-4 font-normal normal-case tracking-normal text-[var(--projects-muted)]/80">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

/** Staggered blur-up used for section entrances — subtle, observability-grade. */
export function AdminReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Sticky page header block shared by all admin pages. */
export function AdminHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  /** Right-side controls (time range, refresh, actions). */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-[var(--projects-border)] pb-4">
      <div className="min-w-0">
        <h1 className="m-0 text-[22px] font-semibold leading-7 tracking-[-0.03em] text-[var(--projects-text)]">
          {title}
        </h1>
        <p className="m-0 mt-1 text-[13px] leading-5 text-[var(--projects-muted)]">
          {subtitle}
        </p>
      </div>
      {children ? (
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          {children}
        </div>
      ) : null}
    </header>
  );
}

/** Page content wrapper: consistent gutters + max width for admin pages. */
export function AdminPageBody({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pb-12 pt-5 sm:px-6 lg:px-7">
      {children}
    </div>
  );
}

/** Mono text helper — technical metadata, ids, timestamps. */
export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("admin-mono", className)}>{children}</span>;
}
