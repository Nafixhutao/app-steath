"use client";

import { useMemo, useState } from "react";
import { Flag, RefreshCw, SearchX } from "lucide-react";
import { useResource } from "@/lib/resource";
import {
  AdminHeader,
  AdminPageBody,
  AdminPanel,
  AdminPanelHeader,
  Mono,
} from "@/features/admin/components/admin-panel";
import { LiveIndicator } from "@/features/admin/components/live-indicator";
import { StatTile } from "@/features/admin/components/stat-tile";
import { StatusBadge } from "@/features/admin/components/status-badge";
import { AdminSelect } from "@/features/admin/components/admin-select";
import { ToolbarSearch } from "@/features/admin/components/toolbar-search";
import { PanelRowsSkeleton } from "@/features/admin/components/admin-skeletons";

import { adminRefreshButtonClass } from "@/components/ui-classes";

export const adminRowActionClass = [
  "inline-flex h-8 items-center rounded-md border border-[var(--projects-border)] bg-[#141416]",
  "px-3 text-[12px] font-medium text-[var(--projects-text)] transition-colors",
  "hover:border-[var(--projects-border-hover)]",
].join(" ");

type Report = {
  id: string;
  targetUrl: string;
  category: string;
  description: string;
  reporterEmail: string | null;
  status: string;
  createdAt: string;
};
type Resource = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  suspendedAt: string | null;
  serviceId: string | null;
  serviceName: string | null;
  platformHostname: string | null;
  status: string | null;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed.");
  return body.data as T;
}

type StatusFilter = "all" | "new" | "triaged" | "resolved" | "dismissed";

function statusTone(status: string): "warning" | "info" | "success" | "neutral" {
  if (status === "new") return "warning";
  if (status === "resolved") return "success";
  if (status === "triaged") return "info";
  return "neutral";
}

const TH_CLASS =
  "px-3 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)] first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const TD_CLASS = "px-3 py-3.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

/**
 * Platform Admin queue of public abuse reports across every Organization,
 * with the cross-organization suspend/unsuspend actions beside it.
 */
export function AbuseReportsPanel() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  // Search and suspend failures share the reports load error's slot.
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // The manual refresh keeps spinning the button like before; the hook's
  // loading only covers the first load.
  const [refreshing, setRefreshing] = useState(false);

  const reports = useResource(() => json<Report[]>("/api/admin/abuse-reports"), []);
  const reportList: Report[] = useMemo(() => reports.data ?? [], [reports.data]);
  const resources = useResource<Resource[]>(async () => [], []);
  const resourceList: Resource[] = resources.data ?? [];
  const loading = reports.loading || refreshing;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return reportList.filter((report) => {
      if (status !== "all" && report.status !== status) return false;
      if (!term) return true;
      return (
        report.category.toLowerCase().includes(term) ||
        report.description.toLowerCase().includes(term) ||
        report.targetUrl.toLowerCase().includes(term) ||
        (report.reporterEmail ?? "").toLowerCase().includes(term)
      );
    });
  }, [reportList, query, status]);

  const openCount = reportList.filter((report) => report.status === "new").length;

  async function refreshReports() {
    setRefreshing(true);
    try {
      await reports.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function updateStatus(id: string, value: string) {
    setBusyId(id);
    setActionError("");
    try {
      await json(`/api/admin/abuse-reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      await reports.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setActionError("");
    try {
      resources.setData(
        await json<Resource[]>(`/api/admin/resources?q=${encodeURIComponent(query)}`),
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Search failed.");
    }
  }

  async function suspend(
    kind: "services" | "organizations",
    id: string,
    action: "suspend" | "unsuspend",
  ) {
    try {
      await json(`/api/admin/suspensions/${kind}/${id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (query.length >= 2)
        resources.setData(
          await json<Resource[]>(`/api/admin/resources?q=${encodeURIComponent(query)}`),
        );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed.");
    }
  }

  return (
    <AdminPageBody>
      <AdminHeader
        title="Abuse reports"
        subtitle="Review public reports and manage Services across Organizations."
      >
        <LiveIndicator live={!(reports.error || actionError)} />
        <button
          type="button"
          onClick={() => void refreshReports()}
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

      {reports.error || actionError ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {reports.error || actionError}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <StatTile
          icon={Flag}
          label="Total reports"
          value={String(reportList.length)}
          className="bg-[var(--projects-card-bg)]"
        />
        <StatTile
          label="New"
          value={String(openCount)}
          tone={openCount > 0 ? "warning" : "neutral"}
          className="bg-[var(--projects-card-bg)]"
        />
        <StatTile
          label="Shown"
          value={String(filtered.length)}
          hint="after filters"
          className="bg-[var(--projects-card-bg)]"
        />
      </div>

      <AdminPanel flush>
        <div className="p-4 pb-3">
          <AdminPanelHeader title="Report queue" />
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 sm:flex sm:flex-wrap sm:items-center">
          <ToolbarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search category, description, reporter…"
            label="Search reports"
            className="col-span-2 sm:col-span-1"
          />
          <AdminSelect
            label="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All statuses" },
              { value: "new", label: "New" },
              { value: "triaged", label: "Triaged" },
              { value: "resolved", label: "Resolved" },
              { value: "dismissed", label: "Dismissed" },
            ]}
          />
        </div>
        {loading && reportList.length === 0 ? (
          <div className="pb-4">
            <PanelRowsSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 pb-10 pt-6 text-center">
            <div className="flex flex-col items-center text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
                {reportList.length === 0 ? (
                  <Flag size={18} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <SearchX size={18} strokeWidth={1.8} aria-hidden="true" />
                )}
              </span>
              <h2 className="m-0 mt-3 text-[15px] font-semibold tracking-[-0.01em] text-[var(--projects-text)]">
                {reportList.length === 0 ? "No reports yet" : "No reports match these filters"}
              </h2>
              <p className="m-0 mt-1 max-w-[42ch] text-[13px] leading-5 text-[var(--projects-muted)]">
                {reportList.length === 0
                  ? "Public abuse reports appear here as they arrive."
                  : "Try a different search term or clear the status filter."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto admin-scrollbar">
            <table className="admin-table w-full min-w-[820px] text-left text-[13px]">
              <caption className="sr-only">
                Public abuse reports with category, description, reporter, status, and the
                moderation actions.
              </caption>
              <thead>
                <tr>
                  <th className={TH_CLASS}>Target</th>
                  <th className={TH_CLASS}>Category</th>
                  <th className={TH_CLASS}>Description</th>
                  <th className={TH_CLASS}>Reporter</th>
                  <th className={TH_CLASS}>Status</th>
                  <th className={TH_CLASS}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((report) => (
                  <tr key={report.id}>
                    <td className={TD_CLASS}>
                      <a
                        href={report.targetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-[220px] truncate text-[13px] text-[var(--admin-info)] hover:underline"
                      >
                        {report.targetUrl}
                      </a>
                      <Mono className="mt-0.5 block text-[11px] text-[var(--projects-muted)]">
                        {relativeDay(report.createdAt)}
                      </Mono>
                    </td>
                    <td className={TD_CLASS}>
                      <span className="text-[13px]">{report.category}</span>
                    </td>
                    <td className={TD_CLASS}>
                      <p className="m-0 max-w-[280px] text-[13px] leading-5 text-[var(--projects-muted)]">
                        {report.description}
                      </p>
                    </td>
                    <td className={TD_CLASS}>
                      <Mono className="block max-w-[180px] truncate text-[12px] text-[var(--projects-muted)]">
                        {report.reporterEmail ?? "Anonymous"}
                      </Mono>
                    </td>
                    <td className={TD_CLASS}>
                      <StatusBadge tone={statusTone(report.status)} label={report.status} />
                    </td>
                    <td className={TD_CLASS}>
                      <select
                        aria-label={`Status for report ${report.id}`}
                        disabled={busyId === report.id}
                        value={report.status}
                        onChange={(e) => void updateStatus(report.id, e.target.value)}
                        className="h-8 rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-2 text-[12px] text-[var(--projects-text)] outline-none disabled:opacity-60"
                      >
                        <option value="new">New</option>
                        <option value="triaged">Triaged</option>
                        <option value="resolved">Resolved</option>
                        <option value="dismissed">Dismissed</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>

      <AdminPanel>
        <AdminPanelHeader
          title="Cross-organization search"
          subtitle="Find an Organization or Service by name, then suspend or restore it."
        />
        <form onSubmit={search} className="flex flex-wrap items-center gap-2">
          <ToolbarSearch
            value={query}
            onChange={setQuery}
            placeholder="Organization or Service…"
            label="Organization or Service"
            className="min-w-[240px]"
          />
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-4 text-[12.5px] font-medium text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04]"
          >
            Search
          </button>
        </form>
        {resourceList.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {resourceList.map((r, i) => (
              <div
                key={`${r.organizationId}-${r.serviceId ?? i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex min-w-0 items-center gap-2 text-[13.5px] font-semibold text-[var(--projects-text)]">
                    <span className="truncate">{r.organizationName}</span>
                    <Mono className="shrink-0 text-[11px] font-normal text-[var(--projects-muted)]">
                      ({r.organizationSlug})
                    </Mono>
                    {r.suspendedAt ? <StatusBadge tone="danger" label="Org suspended" /> : null}
                  </p>
                  {r.serviceId ? (
                    <Mono className="m-0 mt-1 block truncate text-[12px] text-[var(--projects-muted)]">
                      {r.serviceName} · {r.platformHostname ?? "—"} · {r.status ?? "—"}
                    </Mono>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void suspend(
                        "organizations",
                        r.organizationId,
                        r.suspendedAt ? "unsuspend" : "suspend",
                      )
                    }
                    className={adminRowActionClass}
                  >
                    {r.suspendedAt ? "Unsuspend Organization" : "Suspend Organization"}
                  </button>
                  {r.serviceId ? (
                    <button
                      type="button"
                      onClick={() =>
                        void suspend(
                          "services",
                          r.serviceId!,
                          r.status === "suspended" ? "unsuspend" : "suspend",
                        )
                      }
                      className={adminRowActionClass}
                    >
                      {r.status === "suspended" ? "Unsuspend Service" : "Suspend Service"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </AdminPanel>
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
