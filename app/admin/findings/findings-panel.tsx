"use client";

import { useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { getScanFindings, type ScanFindingSummary } from "@/lib/admin-client";
import { useResource } from "@/lib/resource";
import { AdminHeader, AdminPageBody, Mono } from "@/features/admin/components/admin-panel";
import { LiveIndicator } from "@/features/admin/components/live-indicator";
import { StatTile } from "@/features/admin/components/stat-tile";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { AdminSelect } from "@/features/admin/components/admin-select";
import { ToolbarSearch } from "@/features/admin/components/toolbar-search";
import { PanelRowsSkeleton } from "@/features/admin/components/admin-skeletons";

import { adminRefreshButtonClass } from "@/components/ui-classes";

type SeverityFilter = "all" | "urgent" | "critical" | "high" | "medium" | "low";

function severityTone(severity: string): "danger" | "warning" | "info" | "neutral" {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "neutral";
}

function scannerLabel(scanner: string): string {
  return scanner === "clamav" ? "ClamAV" : "Trivy";
}

/** The most useful detail a finding carries, shown under the title. */
function findingNote(finding: ScanFindingSummary): string | null {
  const details = finding.details ?? {};
  const kind = typeof details.kind === "string" ? details.kind : "";
  const pkg = details.package ?? details.ruleId ?? details.id ?? details.path;
  if (typeof pkg === "string" && pkg !== "") {
    return kind === "" ? pkg : `${kind}: ${pkg}`;
  }
  if (kind !== "") return kind;
  if (typeof details.error === "string") return details.error;

  return null;
}

const TH_CLASS =
  "px-3 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)] first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const TD_CLASS = "px-3 py-3.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

/**
 * Platform Admin queue of ScanFindings across every Organization. Urgent
 * findings (high-severity malware) sort first; the severity filter narrows
 * the queue.
 */
export function FindingsPanel() {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  // The manual refresh keeps spinning the button like before; the hook's
  // loading only covers the first load.
  const [refreshing, setRefreshing] = useState(false);

  const list = useResource(() => getScanFindings(), []);
  const findings = useMemo(() => list.data?.findings ?? [], [list.data]);
  const loading = list.loading || refreshing;

  async function refresh() {
    setRefreshing(true);
    try {
      await list.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return findings.filter((finding) => {
      if (severity === "urgent" && !finding.urgent) return false;
      if (severity !== "all" && severity !== "urgent" && finding.severity !== severity) {
        return false;
      }
      if (!term) return true;
      return (
        finding.title.toLowerCase().includes(term) ||
        finding.serviceName.toLowerCase().includes(term) ||
        finding.projectName.toLowerCase().includes(term) ||
        finding.organizationName.toLowerCase().includes(term)
      );
    });
  }, [findings, query, severity]);

  const urgentCount = list.data?.urgent ?? 0;

  return (
    <AdminPageBody>
      <AdminHeader
        title="Scan findings"
        subtitle="Image scan results across every Organization. Urgent findings are high-severity malware."
      >
        <LiveIndicator live={!list.error} />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className={adminRefreshButtonClass}
        >
          <RefreshCw
            size={14}
            strokeWidth={1.8}
            aria-hidden="true"
            className={loading ? "animate-spin" : undefined}
          />
          Refresh
        </button>
      </AdminHeader>

      {list.error ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {list.error}
        </p>
      ) : null}

      {urgentCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[color-mix(in_srgb,var(--projects-danger)_40%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-danger)_7%,#141416)] px-4 py-3.5">
          <StatusBadge tone="danger" label={`${urgentCount} urgent`} pulse />
          <p className="m-0 min-w-0 flex-1 text-[12.5px] leading-5 text-[var(--projects-muted)]">
            Urgent findings need attention — review them before anything else.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <StatTile
          icon={ShieldCheck}
          label="Total findings"
          value={String(list.data?.total ?? 0)}
          className="bg-[var(--projects-card-bg)]"
        />
        <StatTile
          icon={TriangleAlert}
          label="Urgent"
          value={String(urgentCount)}
          tone={urgentCount > 0 ? "danger" : "neutral"}
          className="bg-[var(--projects-card-bg)]"
        />
        <StatTile
          label="Shown"
          value={String(filtered.length)}
          hint="after filters"
          className="bg-[var(--projects-card-bg)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          placeholder="Search finding, service, project…"
          label="Search findings"
          className="col-span-2 sm:col-span-1"
        />
        <AdminSelect
          label="Filter by severity"
          value={severity}
          onChange={setSeverity}
          className="min-w-0"
          options={[
            { value: "all", label: "All severities" },
            { value: "urgent", label: "Urgent only" },
            { value: "critical", label: "Critical" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
        {loading && findings.length === 0 ? (
          <PanelRowsSkeleton />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <div className="flex flex-col items-center text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
                <ShieldCheck size={18} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <h2 className="m-0 mt-3 text-[15px] font-semibold tracking-[-0.01em] text-[var(--projects-text)]">
                {findings.length === 0 ? "No findings" : "No findings match these filters"}
              </h2>
              <p className="m-0 mt-1 max-w-[42ch] text-[13px] leading-5 text-[var(--projects-muted)]">
                {findings.length === 0
                  ? "Every scanned image is clean so far."
                  : "Try a different search term or clear the severity filter."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto admin-scrollbar">
            <table className="admin-table w-full min-w-[820px] text-left text-[13px]">
              <caption className="sr-only">
                Image scan findings with severity, scanner, workload, and the time they were found.
              </caption>
              <thead>
                <tr>
                  <th className={TH_CLASS}>Severity</th>
                  <th className={TH_CLASS}>Finding</th>
                  <th className={TH_CLASS}>Scanner</th>
                  <th className={TH_CLASS}>Organization</th>
                  <th className={TH_CLASS}>Project</th>
                  <th className={TH_CLASS}>Service</th>
                  <th className={TH_CLASS}>Image</th>
                  <th className={TH_CLASS}>Found</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((finding) => (
                  <tr key={finding.id}>
                    <td className={TD_CLASS}>
                      <StatusBadge
                        tone={severityTone(finding.severity)}
                        label={finding.urgent ? `urgent ${finding.severity}` : finding.severity}
                      />
                    </td>
                    <td className={TD_CLASS}>
                      <p className="m-0 text-[13.5px] font-semibold leading-5 text-[var(--projects-text)]">
                        {finding.title}
                      </p>
                      {findingNote(finding) ? (
                        <Mono className="mt-0.5 block truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                          {findingNote(finding)}
                        </Mono>
                      ) : null}
                    </td>
                    <td className={TD_CLASS}>
                      <span className="text-[13px] text-[var(--projects-muted)]">
                        {scannerLabel(finding.scanner)}
                      </span>
                    </td>
                    <td className={TD_CLASS}>
                      <span className="text-[13px] text-[var(--projects-muted)]">
                        {finding.organizationName}
                      </span>
                    </td>
                    <td className={TD_CLASS}>
                      <span className="text-[13px] text-[var(--projects-muted)]">
                        {finding.projectName}
                      </span>
                    </td>
                    <td className={TD_CLASS}>
                      <span className="text-[13px] text-[var(--projects-muted)]">
                        {finding.serviceName}
                      </span>
                    </td>
                    <td className={TD_CLASS}>
                      <Mono className="block max-w-[180px] truncate text-[12px] text-[var(--projects-muted)]">
                        {finding.imageRef ?? "—"}
                      </Mono>
                    </td>
                    <td className={TD_CLASS}>
                      <Mono className="block truncate text-[12.5px] tabular-nums text-[var(--projects-muted)]">
                        {relativeDay(finding.createdAt)}
                      </Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminPageBody>
  );
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function relativeDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 45_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return dayFormat.format(date);
}
