"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  RefreshCw,
  SearchX,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useAdminAccounts } from "@/features/admin/data/admin-read-model";
import type { components } from "@/lib/admin/api-schema";
import { formatCount, formatDate, formatRelative } from "@/lib/format";
import {
  AdminHeader,
  AdminPageBody,
  AdminReveal,
  Mono,
} from "../components/admin-panel";
import { AdminSelect } from "../components/admin-select";
import { StatusBadge } from "../components/status-badge";
import { useUpdateAdminAccountPlan } from "@/features/admin/data/admin-mutations";
import { planLabel } from "../components/admin-select";
import { AccountActions } from "./account-actions";
import { LiveIndicator } from "../components/live-indicator";
import { StatTile } from "../components/stat-tile";
import { ToolbarSearch } from "../components/toolbar-search";
import {
  GradientAvatar,
  SignInMethods,
  VerifiedBadge,
  maskEmail,
} from "./user-table-pieces";

type AdminAccount = components["schemas"]["AdminAccount"];

type VerifiedFilter = "all" | "verified" | "unverified";
type SortKey = "recent" | "newest" | "oldest" | "name";

const PAGE_SIZE = 12;

function planTone(plan: string) {
  if (plan === "pro") return "success" as const;
  if (plan === "plus") return "warning" as const;
  if (plan === "go") return "info" as const;
  return "neutral" as const;
}

const TH_CLASS =
  "px-3 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--projects-muted)] first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const TD_CLASS =
  "px-3 py-3.5 align-middle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

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

function displayNameOf(account: AdminAccount): string {
  const name = account.display_name?.trim();
  return name || maskEmail(account.email);
}

/** Directory totals for the stat tiles. Module-level like relativeTime in
    recent-deployments, so the clock never lives in the component body. */
function computeStats(items: AdminAccount[]) {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  let verifiedCount = 0;
  let active = 0;
  for (const account of items) {
    if (account.email_verified) verifiedCount += 1;
    if (account.last_sign_in_at) {
      const seen = new Date(account.last_sign_in_at).getTime();
      if (Number.isFinite(seen) && now - seen >= 0 && now - seen <= week)
        active += 1;
    }
  }
  return { total: items.length, verifiedCount, active };
}

/**
 * Users — the Console account directory as a real table: header, stat tiles,
 * filter toolbar, then a semantic table with sortable User / Last active /
 * Added columns. The table scrolls horizontally on narrow screens instead of
 * collapsing into cards. Pagination is client-side and always reflects the
 * filtered set.
 */
export function UsersPage() {
  const [query, setQuery] = useState("");
  const [verified, setVerified] = useState<VerifiedFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);
  const [menuAccountID, setMenuAccountID] = useState<string | null>(null);

  const accounts = useAdminAccounts();
  const items = useMemo(() => accounts.data?.items ?? [], [accounts.data]);
  const planMutation = useUpdateAdminAccountPlan();
  // Row-scoped pending state: only the plan picker being saved spins.
  const pendingPlanID = planMutation.variables?.accountID;
  const planPending = planMutation.isPending;

  // Defer the filter so typing stays responsive on large directories.
  const deferredQuery = useDeferredValue(query);

  // The 7-day activity window is evaluated at render through a module helper
  // (same pattern as relativeTime in recent-deployments). The scan is a
  // single cheap pass, so no memo is needed.
  const stats = computeStats(items);

  const sorted = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    const filtered = items.filter((account) => {
      if (verified === "verified" && !account.email_verified) return false;
      if (verified === "unverified" && account.email_verified) return false;
      if (!term) return true;
      // Search matches the real email even though the list renders it masked,
      // so an operator can still find an account without reading it aloud.
      return (
        account.email.toLowerCase().includes(term) ||
        (account.display_name ?? "").toLowerCase().includes(term) ||
        account.id.toLowerCase().includes(term)
      );
    });

    const byTime = (iso?: string) => {
      if (!iso) return Number.NEGATIVE_INFINITY;
      const time = new Date(iso).getTime();
      return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
    };
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "newest":
          return byTime(b.created_at) - byTime(a.created_at);
        case "oldest":
          return byTime(a.created_at) - byTime(b.created_at);
        case "name":
          return displayNameOf(a)
            .toLowerCase()
            .localeCompare(displayNameOf(b).toLowerCase());
        case "recent":
        default:
          return (
            byTime(b.last_sign_in_at) - byTime(a.last_sign_in_at) ||
            byTime(b.created_at) - byTime(a.created_at)
          );
      }
    });
  }, [items, deferredQuery, verified, sort]);

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

  const hasFilters = deferredQuery.trim() !== "" || verified !== "all";
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
        <LiveIndicator live={!accounts.isError} />
        <button
          type="button"
          onClick={() => void accounts.refetch()}
          disabled={accounts.isFetching}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-border)] bg-[#141416] px-3 text-[12.5px] font-medium leading-none text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] disabled:opacity-60"
        >
          <RefreshCw
            size={14}
            strokeWidth={1.8}
            aria-hidden="true"
            className={accounts.isFetching ? "animate-spin" : undefined}
          />
          Refresh
        </button>
      </AdminHeader>

      <AdminReveal>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
          <StatTile
            icon={Users}
            label="Total accounts"
            value={formatCount(stats.total)}
          />
          <StatTile
            icon={BadgeCheck}
            label="Verified emails"
            value={formatCount(stats.verifiedCount)}
            tone="success"
          />
          <StatTile
            icon={Activity}
            label="Active · 7 days"
            value={formatCount(stats.active)}
            tone="success"
          />
        </div>
      </AdminReveal>

      <AdminReveal delay={0.05}>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <ToolbarSearch
            value={query}
            onChange={handleQueryChange}
            placeholder="Search name or email…"
            label="Search users"
            className="col-span-2 sm:col-span-1"
          />
          <AdminSelect
            label="Filter by verification"
            value={verified}
            onChange={handleVerifiedChange}
            className="min-w-0 [&>button]:w-full [&>button]:justify-between"
            options={[
              { value: "all", label: "All statuses" },
              { value: "verified", label: "Verified" },
              { value: "unverified", label: "Unverified" },
            ]}
          />
          <div className="col-span-2 ml-auto flex items-center gap-2">
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-9 items-center rounded-lg px-2 text-[12.5px] font-medium text-[var(--projects-muted)] transition-colors hover:bg-white/[0.04] hover:text-[var(--projects-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)]"
              >
                Clear
              </button>
            )}
            <span
              aria-live="polite"
              className="text-[11.5px] tabular-nums text-[var(--projects-muted)]"
            >
              <Mono className="text-[11.5px] tabular-nums text-[var(--projects-muted)]">
                {formatCount(sorted.length)} of {formatCount(items.length)}{" "}
                shown
              </Mono>
            </span>
          </div>
        </div>
      </AdminReveal>

      <AdminReveal delay={0.1}>
        <div className="overflow-hidden rounded-lg border border-[var(--projects-border)] bg-[#141416]">
          {accounts.isPending && (
            <p className="sr-only" role="status">
              Loading users…
            </p>
          )}
          <div className="overflow-x-auto admin-scrollbar">
            <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
              <caption className="sr-only">
                Console accounts with subscription plan, sign-in method, last
                activity, and join date. Sort with the User, Last active, and
                Added column headers. Change a plan with the promote and demote
                actions.
              </caption>
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--projects-divider)] bg-[var(--projects-control)]">
                  <SortableHeader
                    label="User"
                    sortLabel="Sort by name"
                    active={sort === "name"}
                    direction="asc"
                    onSort={() => handleSortChange("name")}
                  />
                  <StaticHeader label="Plan" />
                  <StaticHeader label="Sign-in" />
                  <SortableHeader
                    label="Last active"
                    sortLabel="Sort by recent activity"
                    active={sort === "recent"}
                    direction="desc"
                    onSort={() => handleSortChange("recent")}
                  />
                  <SortableHeader
                    label="Added"
                    sortLabel={
                      sort === "oldest"
                        ? "Sort by newest first"
                        : "Sort by oldest first"
                    }
                    active={addedActive}
                    direction={sort === "oldest" ? "asc" : "desc"}
                    onSort={toggleAddedSort}
                  />
                  <StaticHeader label="Actions" />
                </tr>
              </thead>
              <tbody aria-hidden={accounts.isPending ? true : undefined}>
                {accounts.isPending ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr
                      key={index}
                      className="border-b border-[var(--projects-divider)] last:border-b-0"
                    >
                      <td className={TD_CLASS}>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="size-8 shrink-0 animate-pulse rounded-full bg-white/[0.05] motion-reduce:animate-none" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="h-3.5 w-28 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                            <div className="h-3 w-36 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                          </div>
                        </div>
                      </td>
                      <td className={TD_CLASS}>
                        <div className="h-3.5 w-12 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                      </td>
                      <td className={TD_CLASS}>
                        <div className="h-3.5 w-14 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                      </td>
                      <td className={TD_CLASS}>
                        <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                      </td>
                      <td className={TD_CLASS}>
                        <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                      </td>
                      <td className={TD_CLASS}>
                        <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                      </td>
                      <td className={TD_CLASS}>
                        <div className="h-3.5 w-16 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                      </td>
                    </tr>
                  ))
                ) : accounts.isError ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center sm:px-5">
                      <div className="flex flex-col items-center text-center">
                        <span className="flex size-10 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--projects-danger)_40%,var(--projects-border))] bg-[color-mix(in_srgb,var(--projects-danger)_10%,transparent)] text-[var(--projects-danger)]">
                          <TriangleAlert
                            size={18}
                            strokeWidth={1.8}
                            aria-hidden="true"
                          />
                        </span>
                        <h2 className="m-0 mt-3 text-[15px] font-semibold tracking-[-0.01em] text-[var(--projects-text)] [text-wrap:balance]">
                          Could not load accounts
                        </h2>
                        <p className="m-0 mt-1 max-w-[38ch] text-[13px] leading-5 text-[var(--projects-muted)] [text-wrap:pretty]">
                          Check your connection and retry. The directory reloads
                          automatically every 30 seconds.
                        </p>
                        <button
                          type="button"
                          onClick={() => void accounts.refetch()}
                          disabled={accounts.isFetching}
                          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-4 text-[13px] font-medium text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] disabled:opacity-60"
                        >
                          <RefreshCw
                            size={14}
                            strokeWidth={1.8}
                            aria-hidden="true"
                            className={
                              accounts.isFetching ? "animate-spin" : undefined
                            }
                          />
                          Try again
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center sm:px-5">
                      <div className="flex flex-col items-center text-center">
                        <span className="flex size-10 items-center justify-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-muted)]">
                          {items.length === 0 ? (
                            <Users
                              size={18}
                              strokeWidth={1.8}
                              aria-hidden="true"
                            />
                          ) : (
                            <SearchX
                              size={18}
                              strokeWidth={1.8}
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <h2 className="m-0 mt-3 text-[15px] font-semibold tracking-[-0.01em] text-[var(--projects-text)] [text-wrap:balance]">
                          {items.length === 0
                            ? "No accounts yet"
                            : "No accounts match these filters"}
                        </h2>
                        <p className="m-0 mt-1 max-w-[42ch] text-[13px] leading-5 text-[var(--projects-muted)] [text-wrap:pretty]">
                          {items.length === 0
                            ? "Accounts appear here once people sign up or are invited."
                            : "Try a different search term or clear the role and verification filters."}
                        </p>
                        {items.length > 0 && hasFilters && (
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="mt-4 inline-flex h-9 items-center rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-4 text-[13px] font-medium text-[var(--projects-text)] transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)]"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  paged.map((account, index) => {
                    const busy = planPending && pendingPlanID === account.id;
                    return (
                      <tr
                        key={account.id}
                        className="border-b border-[var(--projects-divider)] transition-colors last:border-b-0 hover:bg-white/[0.02]"
                      >
                        <td className={TD_CLASS}>
                          <div className="flex min-w-0 items-center gap-3">
                            <GradientAvatar
                              email={account.email}
                              url={account.avatar_url}
                              size={32}
                            />
                            <UserIdentity account={account} />
                          </div>
                        </td>
                        <td className={TD_CLASS}>
                          <StatusBadge
                            tone={planTone(account.plan)}
                            label={planLabel(account.plan)}
                          />
                        </td>
                        <td className={TD_CLASS}>
                          <span className="block truncate">
                            <SignInMethods
                              providers={[...account.providers]}
                              lastMethod={account.last_sign_in_method}
                            />
                          </span>
                        </td>
                        <td className={TD_CLASS}>
                          {account.last_sign_in_at ? (
                            <span
                              title={formatDate(account.last_sign_in_at)}
                              className="block truncate"
                            >
                              <Mono className="truncate text-[12.5px] tabular-nums text-[var(--projects-muted)]">
                                {formatRelative(account.last_sign_in_at)}
                              </Mono>
                            </span>
                          ) : (
                            <Mono className="block truncate text-[12.5px] tabular-nums text-[var(--projects-muted)]">
                              Never
                            </Mono>
                          )}
                        </td>
                        <td className={TD_CLASS}>
                          <span
                            title={formatDate(account.created_at)}
                            className="block truncate"
                          >
                            <Mono className="truncate text-[12.5px] tabular-nums text-[var(--projects-muted)]">
                              {shortDay(account.created_at)}
                            </Mono>
                          </span>
                        </td>
                        <td className={TD_CLASS}>
                          <AccountActions
                            account={account}
                            busy={busy}
                            open={menuAccountID === account.id}
                            flipUp={index >= paged.length - 2}
                            onToggle={() =>
                              setMenuAccountID((current) =>
                                current === account.id ? null : account.id,
                              )
                            }
                            onPlanChange={(target) =>
                              planMutation.mutate({
                                accountID: account.id,
                                plan: target as components["schemas"]["UpdateAdminAccountPlanRequest"]["plan"],
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {sorted.length > 0 && (
            <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--projects-divider)] bg-[var(--projects-card-bg)] px-4 py-3 sm:px-5">
              <p className="m-0 text-xs tabular-nums text-[var(--projects-muted)]">
                Showing {formatCount(rangeStart)}–{formatCount(rangeEnd)} of{" "}
                {formatCount(sorted.length)}{" "}
                {sorted.length === 1 ? "account" : "accounts"}
              </p>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--projects-border)] text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] disabled:opacity-40 disabled:hover:border-[var(--projects-border)] disabled:hover:text-[var(--projects-muted)]"
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
                  className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--projects-border)] text-[var(--projects-muted)] transition-colors hover:border-[var(--projects-border-hover)] hover:text-[var(--projects-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] disabled:opacity-40 disabled:hover:border-[var(--projects-border)] disabled:hover:text-[var(--projects-muted)]"
                >
                  <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </footer>
          )}
        </div>
      </AdminReveal>
    </AdminPageBody>
  );
}

function StaticHeader({ label }: { label: string }) {
  return (
    <th scope="col" className={TH_CLASS}>
      {label}
    </th>
  );
}

function SortableHeader({
  label,
  sortLabel,
  active,
  direction,
  onSort,
}: {
  label: string;
  sortLabel: string;
  active: boolean;
  direction: "asc" | "desc";
  onSort: () => void;
}) {
  let ariaSort: "ascending" | "descending" | undefined;
  if (active) ariaSort = direction === "asc" ? "ascending" : "descending";
  return (
    <th scope="col" aria-sort={ariaSort} className={TH_CLASS}>
      <button
        type="button"
        onClick={onSort}
        aria-label={sortLabel}
        title={sortLabel}
        className={`inline-flex max-w-full items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.08em] transition-colors hover:text-[var(--projects-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--projects-accent)] ${
          active
            ? "text-[var(--projects-text)]"
            : "text-[var(--projects-muted)]"
        }`}
      >
        <span className="truncate">{label}</span>
        {active ? (
          direction === "asc" ? (
            <ArrowUp
              size={12}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0"
            />
          ) : (
            <ArrowDown
              size={12}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0"
            />
          )
        ) : (
          <ChevronsUpDown
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            className="shrink-0 opacity-40"
          />
        )}
      </button>
    </th>
  );
}

function UserIdentity({ account }: { account: AdminAccount }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="m-0 flex min-w-0 items-center gap-1.5 text-[14px] font-semibold leading-5 text-[var(--projects-text)]">
        <span className="min-w-0 truncate">{displayNameOf(account)}</span>
        {account.email_verified ? <VerifiedBadge /> : null}
      </p>
      <span title={account.email} className="m-0 mt-0.5 block truncate">
        <Mono className="block truncate text-[12px] leading-4 text-[var(--projects-muted)]">
          {maskEmail(account.email)}
        </Mono>
      </span>
    </div>
  );
}
