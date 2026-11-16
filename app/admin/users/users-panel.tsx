"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  SearchX,
  Users,
} from "lucide-react";
import {
  getAdminAccounts,
  type AdminAccount,
} from "@/lib/admin-client";
import { AdminHeader, AdminPageBody, Mono } from "@/components/admin/admin-panel";
import { LiveIndicator } from "@/components/admin/live-indicator";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusBadge } from "@/components/admin/status-badge";

/** Rows per page — the directory paginates client-side. */
const PAGE_SIZE = 12;

/** How often the panel re-reads the API while it stays open. */
const REFRESH_INTERVAL_MS = 30_000;

type VerifiedFilter = "all" | "verified" | "unverified";
type SortKey = "recent" | "newest" | "oldest" | "name";

function getError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function shortDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return dayFormat.format(date);
}

function formatDate(iso: string | null): string {
  if (!iso) return "Not available";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString();
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 0) return formatDate(iso);
  if (elapsed < 45_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed > 7 * 86_400_000) return shortDay(iso);
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

/** Masks the middle of an email so a directory scan never reads it aloud. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Deterministic avatar hue from the email, so a user keeps their color. */
function avatarHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) % 360;
  }
  return hash;
}

function planTone(organizations: number): "success" | "neutral" {
  return organizations > 0 ? "success" : "neutral";
}

/** Directory totals for the stat tiles. */
function computeStats(items: AdminAccount[]) {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  let verifiedCount = 0;
  let active = 0;
  for (const account of items) {
    if (account.emailVerified) verifiedCount += 1;
    if (account.lastSignInAt) {
      const seen = new Date(account.lastSignInAt).getTime();
      if (Number.isFinite(seen) && now - seen >= 0 && now - seen <= week) {
        active += 1;
      }
    }
  }
  return { total: items.length, verifiedCount, active };
}

/**
 * Users — the platform account directory as a real table: header, stat tiles,
 * filter toolbar, then a semantic table with sortable User / Last active /
 * Added columns. The table scrolls horizontally on narrow screens instead of
 * collapsing into cards. Pagination is client-side and always reflects the
 * filtered set.
 */
export function UsersPanel() {
  const [items, setItems] = useState<AdminAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [verified, setVerified] = useState<VerifiedFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAdminAccounts();
      setItems(list.items);
      setError("");
    } catch (cause) {
      setError(getError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const accounts = useMemo(() => items ?? [], [items]);

  const stats = useMemo(() => computeStats(accounts), [accounts]);

  const sorted = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = accounts.filter((account) => {
      if (verified === "verified" && !account.emailVerified) return false;
      if (verified === "unverified" && account.emailVerified) return false;
      if (!term) return true;
      return (
        account.email.toLowerCase().includes(term) ||
        account.name.toLowerCase().includes(term) ||
        (account.username ?? "").toLowerCase().includes(term) ||
        account.id.toLowerCase().includes(term)
      );
    });

    const byTime = (iso: string | null) => {
      if (!iso) return Number.NEGATIVE_INFINITY;
      const time = new Date(iso).getTime();
      return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
    };
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "newest":
          return byTime(b.createdAt) - byTime(a.createdAt);
        case "oldest":
          return byTime(a.createdAt) - byTime(b.createdAt);
        case "name":
          return a.name
            .toLowerCase()
            .localeCompare(b.name.toLowerCase());
        case "recent":
        default:
          return (
            byTime(b.lastSignInAt) - byTime(a.lastSignInAt) ||
            byTime(b.createdAt) - byTime(a.createdAt)
          );
      }
    });
  }, [accounts, query, verified, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage],
  );

  // Filtering or sorting restarts at the first page. This lives in the event
  // handlers (not an effect) so no cascading render occurs.
  const handleQueryChange = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const handleVerifiedChange = (value: VerifiedFilter) => {
    setVerified(value);
    setPage(1);
  };
  const handleSortChange = (value: SortKey) => {
    setSort(value);
    setPage(1);
  };
  const toggleAddedSort = () => {
    setSort((current) => (current === "oldest" ? "newest" : "oldest"));
    setPage(1);
  };

  const hasFilters = query.trim() !== "" || verified !== "all";
  const rangeStart = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, sorted.length);
  const addedActive = sort === "newest" || sort === "oldest";

  const clearFilters = () => {
    setQuery("");
    setVerified("all");
    setPage(1);
  };

  return (
    <AdminPageBody>
      <AdminHeader
        title="Users"
        subtitle="People with access to the platform and their activity."
      >
        <LiveIndicator live={!error} />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] font-medium leading-none text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04] disabled:opacity-60"
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

      {error ? (
        <p className="dashboard-alert is-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <StatTile icon={Users} label="Total accounts" value={String(stats.total)} />
        <StatTile
          icon={BadgeCheck}
          label="Verified emails"
          value={String(stats.verifiedCount)}
          tone="success"
        />
        <StatTile
          icon={Activity}
          label="Active · 7 days"
          value={String(stats.active)}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Search name or email…"
          aria-label="Search users"
          className="col-span-2 h-9 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] text-[var(--projects-text)] outline-none placeholder:text-[var(--projects-muted)] focus:border-[var(--projects-border-hover)] sm:col-span-1"
        />
        <select
          aria-label="Filter by verification"
          value={verified}
          onChange={(event) => handleVerifiedChange(event.target.value as VerifiedFilter)}
          className="h-9 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] text-[var(--projects-text)] outline-none focus:border-[var(--projects-border-hover)]"
        >
          <option value="all">All statuses</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
        </select>
        <select
          aria-label="Sort accounts"
          value={sort}
          onChange={(event) => handleSortChange(event.target.value as SortKey)}
          className="h-9 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] text-[var(--projects-text)] outline-none focus:border-[var(--projects-border-hover)]"
        >
          <option value="recent">Recently active</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name</option>
        </select>
        <div className="col-span-2 ml-auto flex items-center gap-2">
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-9 items-center rounded-lg px-2 text-[12.5px] font-medium text-[var(--projects-muted)] transition-colors hover:bg-white/[0.04] hover:text-[var(--projects-text)]"
            >
              Clear
            </button>
          )}
          <span aria-live="polite" className="text-[11.5px] tabular-nums text-[var(--projects-muted)]">
            <Mono className="text-[11.5px] tabular-nums text-[var(--projects-muted)]">
              {sorted.length} of {accounts.length} shown
            </Mono>
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
        <div className="overflow-x-auto admin-scrollbar">
          <table className="admin-table">
            <caption className="sr-only">
              Platform accounts with verification, organizations, sign-in
              activity, and join date. Sort with the User, Last active, and
              Added column headers.
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <button type="button" onClick={() => handleSortChange("name")}>
                    User
                  </button>
                </th>
                <th scope="col">Orgs</th>
                <th scope="col">Verified</th>
                <th scope="col">
                  <button type="button" onClick={() => handleSortChange("recent")}>
                    Last active
                  </button>
                </th>
                <th scope="col">
                  <button type="button" onClick={toggleAddedSort}>
                    Added {addedActive ? (sort === "oldest" ? "↑" : "↓") : "↕"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody aria-hidden={loading && accounts.length === 0 ? true : undefined}>
              {loading && accounts.length === 0
                ? Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      <td>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="size-8 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="h-3.5 w-28 animate-pulse rounded bg-white/[0.05]" />
                            <div className="h-3 w-36 animate-pulse rounded bg-white/[0.05]" />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="h-3.5 w-8 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                      <td>
                        <div className="h-3.5 w-14 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                      <td>
                        <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                      <td>
                        <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                    </tr>
                  ))
                : paged.length === 0
                  ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-14 text-center sm:px-5">
                        <div className="flex flex-col items-center text-center">
                          <span className="flex size-10 items-center justify-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
                            {accounts.length === 0 ? (
                              <Users size={18} strokeWidth={1.8} aria-hidden="true" />
                            ) : (
                              <SearchX size={18} strokeWidth={1.8} aria-hidden="true" />
                            )}
                          </span>
                          <h2 className="m-0 mt-3 text-[15px] font-semibold tracking-[-0.01em] text-[var(--projects-text)]">
                            {accounts.length === 0
                              ? "No accounts yet"
                              : "No accounts match these filters"}
                          </h2>
                          <p className="m-0 mt-1 max-w-[42ch] text-[13px] leading-5 text-[var(--projects-muted)]">
                            {accounts.length === 0
                              ? "Accounts appear here once people sign up."
                              : "Try a different search term or clear the verification filter."}
                          </p>
                          {accounts.length > 0 && hasFilters && (
                            <button
                              type="button"
                              onClick={clearFilters}
                              className="mt-4 inline-flex h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-4 text-[13px] font-medium text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04]"
                            >
                              Clear filters
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                  : paged.map((account) => (
                      <tr key={account.id}>
                        <td>
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                              style={{
                                background: `linear-gradient(135deg, hsl(${avatarHue(account.email)} 45% 38%), hsl(${(avatarHue(account.email) + 40) % 360} 45% 28%))`,
                              }}
                            >
                              {initialsOf(account.name || account.email)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="m-0 flex min-w-0 items-center gap-1.5 text-[14px] font-semibold leading-5 text-[var(--projects-text)]">
                                <span className="min-w-0 truncate">{account.name}</span>
                                {account.emailVerified ? <BadgeCheck size={14} strokeWidth={1.8} className="shrink-0 text-[var(--projects-accent)]" aria-label="Verified" /> : null}
                              </p>
                              <span title={account.email} className="m-0 mt-0.5 block truncate">
                                <Mono className="block truncate text-[12px] leading-4 text-[var(--projects-muted)]">
                                  {maskEmail(account.email)}
                                </Mono>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <StatusBadge
                            tone={planTone(account.organizations)}
                            label={String(account.organizations)}
                          />
                        </td>
                        <td>
                          <StatusBadge
                            tone={account.emailVerified ? "success" : "warning"}
                            label={account.emailVerified ? "Verified" : "Unverified"}
                          />
                        </td>
                        <td>
                          <span title={formatDate(account.lastSignInAt)} className="block truncate">
                            <Mono className="block truncate text-[12.5px] tabular-nums text-[var(--projects-muted)]">
                              {relativeTime(account.lastSignInAt)}
                            </Mono>
                          </span>
                        </td>
                        <td>
                          <span title={formatDate(account.createdAt)} className="block truncate">
                            <Mono className="block truncate text-[12.5px] tabular-nums text-[var(--projects-muted)]">
                              {shortDay(account.createdAt)}
                            </Mono>
                          </span>
                        </td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>

        {sorted.length > 0 && (
          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--projects-divider)] bg-[var(--projects-card-bg)] px-4 py-3 sm:px-5">
            <p className="m-0 text-xs tabular-nums text-[var(--projects-muted)]">
              Showing {rangeStart}–{rangeEnd} of {sorted.length}{" "}
              {sorted.length === 1 ? "account" : "accounts"}
            </p>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous page"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--projects-border)] text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)] disabled:opacity-40"
              >
                <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <span
                aria-live="polite"
                aria-label={`Page ${safePage} of ${totalPages}`}
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-[var(--projects-control)] px-1.5"
              >
                <Mono className="text-xs tabular-nums text-[var(--projects-text)]">
                  {safePage} / {totalPages}
                </Mono>
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--projects-border)] text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)] disabled:opacity-40"
              >
                <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </footer>
        )}
      </div>
    </AdminPageBody>
  );
}
