"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Globe,
  Plus,
  Search,
  X,
  ExternalLink,
  ShieldCheck,
  RotateCw,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Lock,
  Layers,
  Server,
  FileText,
  Info,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { useActiveMember, useActiveOrganization } from "@/lib/auth-client";
import { useResource, getError } from "@/lib/resource";
import {
  listOrganizationCustomDomains,
  addServiceCustomDomain,
  verifyServiceCustomDomain,
  deleteServiceCustomDomain,
  type OrganizationCustomDomainSummary,
} from "@/lib/custom-domains-client";
import { listOrganizationServices } from "@/lib/services-client";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/toast-context";
import { copyToClipboard } from "@/lib/clipboard";
import { ModalDialog } from "@/components/supabase-modal";

import { compactSecondaryButtonClass, dangerButtonClass, filterSelectClass, modalCloseClass, secondaryButtonClass, successBadgeClass } from "@/components/ui-classes";

export const domainsTableClass = [
  "domains-table w-full text-left [&_th]:px-[18px] [&_th]:py-[12px] [&_th]:text-[11px]",
  "[&_th]:font-medium [&_th]:uppercase [&_th]:tracking-[0.05em] [&_th]:text-[#878492]",
  "[&_th]:border-b [&_th]:border-[var(--color-surface-raised)] [&_th]:bg-[#131217]",
  "[&_td]:px-[18px] [&_td]:py-[14px] [&_td]:border-b [&_td]:border-[#1f1d25] [&_td]:text-[13px]",
  "[&_td]:align-middle [&_tr:hover>td]:bg-[rgba(255,255,255,0.015)]",
  "[&_tr:last-child>td]:border-b-0",
].join(" ");

export const dnsRecordTagClass = [
  "bg-[rgba(62,207,142,0.12)]",
  "[font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace] text-[10px]",
  "font-bold py-[2px] px-[6px] rounded-control-sm text-accent border",
  "border-[rgba(62,207,142,0.25)]",
].join(" ");

export default function DomainsPage() {
  const { toast } = useToast();
  const { data: organization } = useActiveOrganization();
  const { data: activeMember } = useActiveMember();
  const organizationId = organization?.id;
  // Better Auth stores multiple roles as a comma-separated string, so check the
  // parsed set rather than the raw value.
  const canManage =
    activeMember?.role
      .split(",")
      .some((role) => role.trim() === "owner" || role.trim() === "admin") ?? false;

  const [activeTab, setActiveTab] = useState<"custom" | "platform" | "guide">("custom");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Modals state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [newHostname, setNewHostname] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);
  const [addError, setAddError] = useState("");

  const [instructionsDomain, setInstructionsDomain] =
    useState<OrganizationCustomDomainSummary | null>(null);
  const [deletingDomain, setDeletingDomain] = useState<OrganizationCustomDomainSummary | null>(
    null,
  );
  const [busyDelete, setBusyDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Load custom domains
  const customDomainsResource = useResource(
    () => listOrganizationCustomDomains(),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );
  const customDomains = useMemo(
    () => customDomainsResource.data ?? [],
    [customDomainsResource.data],
  );

  // Load services for platform subdomains and add modal
  const servicesResource = useResource(() => listOrganizationServices(), [organizationId], {
    enabled: Boolean(organizationId),
  });
  const services = useMemo(() => servicesResource.data ?? [], [servicesResource.data]);

  const loading = customDomainsResource.loading || servicesResource.loading;

  // Filter available services for adding domain (only services without custom domain)
  const availableServices = useMemo(() => {
    const usedServiceIds = new Set(customDomains.map((d) => d.serviceId));
    return services.filter((s) => !usedServiceIds.has(s.id));
  }, [services, customDomains]);

  // Filter custom domains
  const filteredDomains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customDomains.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!q) return true;
      return (
        d.hostname.toLowerCase().includes(q) ||
        d.serviceName.toLowerCase().includes(q) ||
        d.projectName.toLowerCase().includes(q)
      );
    });
  }, [customDomains, search, statusFilter]);

  // Counts
  const activeCount = useMemo(
    () => customDomains.filter((d) => d.status === "active").length,
    [customDomains],
  );
  const pendingCount = useMemo(
    () => customDomains.filter((d) => d.status === "pending").length,
    [customDomains],
  );

  async function copyText(text: string, key: string, label: string) {
    if (!(await copyToClipboard(text))) {
      toast.error("Copy failed", "Clipboard access is unavailable.");
      return;
    }
    setCopiedKey(key);
    toast.success("Copied to clipboard", `${label}: ${text}`);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  }

  async function handleRefresh() {
    await Promise.all([customDomainsResource.refresh(), servicesResource.refresh()]);
  }

  async function handleAddDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedServiceId || !newHostname.trim()) return;

    setBusyAdd(true);
    setAddError("");
    try {
      const created = await addServiceCustomDomain(selectedServiceId, newHostname.trim());
      setAddModalOpen(false);
      setNewHostname("");
      setSelectedServiceId("");
      toast.success("Custom domain added", `DNS records generated for ${created.hostname}.`);
      await customDomainsResource.refresh();
      // Auto open instructions modal for newly added domain
      const updated = await listOrganizationCustomDomains();
      const match = updated.find((d) => d.id === created.id);
      if (match) {
        setInstructionsDomain(match);
      }
    } catch (err) {
      setAddError(getError(err));
    } finally {
      setBusyAdd(false);
    }
  }

  async function handleVerify(domain: OrganizationCustomDomainSummary) {
    setVerifyingId(domain.id);
    try {
      const result = await verifyServiceCustomDomain(domain.serviceId);
      await customDomainsResource.refresh();
      if (result.status === "active") {
        toast.success(
          "Domain verified!",
          `${domain.hostname} is active with SSL certificate issued.`,
        );
        if (instructionsDomain?.id === domain.id) {
          setInstructionsDomain({ ...domain, ...result });
        }
      } else {
        toast.error(
          "Verification pending",
          result.lastError || "DNS records have not propagated yet.",
        );
      }
    } catch (err) {
      toast.error("Verification failed", getError(err));
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleDeleteDomain() {
    if (!deletingDomain) return;
    setBusyDelete(true);
    setDeleteError("");
    try {
      await deleteServiceCustomDomain(deletingDomain.serviceId);
      toast.success("Domain removed", `${deletingDomain.hostname} has been disconnected.`);
      setDeletingDomain(null);
      await customDomainsResource.refresh();
    } catch (err) {
      setDeleteError(getError(err));
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <div className="pt-[28px] pb-[64px] px-[36px] max-w-[1200px] mx-auto w-full">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-[16px] mb-[24px]">
        <div className="flex items-center gap-3">
          <div className="w-[40px] h-[40px] rounded-panel bg-[rgba(62,207,142,0.1)] border border-[rgba(62,207,142,0.25)] flex items-center justify-center shrink-0" aria-hidden="true">
            <Globe className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[22px]! font-semibold! text-ink tracking-[-0.015em]! m-0">Domains &amp; Networking</h1>
              <span className={successBadgeClass}>EDGE PROXY</span>
            </div>
            <p className="text-[13px] text-[#878492] mt-[4px] leading-[1.4]">
              Manage custom brand domains, SSL/TLS certificates, and platform subdomains for{" "}
              {organization?.name ?? "your organization"}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => void handleRefresh()}
            disabled={loading}
            title="Refresh domains and routing status"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          {canManage && (
            <button
              type="button"
              className="supabase-btn-green"
              onClick={() => {
                setAddError("");
                if (availableServices.length > 0) {
                  setSelectedServiceId(availableServices[0].id);
                }
                setAddModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
              <span>Add Custom Domain</span>
            </button>
          )}
        </div>
      </header>

      {/* Global Alerts */}
      {customDomainsResource.error ? (
        <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error my-4" role="alert">
          {customDomainsResource.error}
        </div>
      ) : null}

      {/* Overview Metric Cards */}
      <section
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
        aria-label="Domain metrics"
      >
        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Custom Domains</span>
            <Globe className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2]">{customDomains.length}</span>
          <span className="text-[11px] text-zinc-500">Connected brand hostnames</span>
        </div>

        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Active &amp; SSL Issued</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2] text-emerald-400">{activeCount}</span>
          <span className="text-[11px] text-zinc-500">HTTPS live on edge proxy</span>
        </div>

        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Pending Verification</span>
            <RotateCw
              className={`w-4 h-4 ${pendingCount > 0 ? "text-amber-400 animate-spin" : "text-zinc-500"}`}
            />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2] text-amber-400">{pendingCount}</span>
          <span className="text-[11px] text-zinc-500">Awaiting DNS propagation</span>
        </div>

        <div className="bg-surface border border-surface-raised rounded-panel py-[16px] px-[18px] flex flex-col gap-[6px] [transition:border-color_150ms_ease] hover:border-[#34313c]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#878492] uppercase tracking-[0.04em]">Platform Subdomains</span>
            <Server className="w-4 h-4 text-blue-400" />
          </div>
          <span className="text-[22px] font-semibold text-ink tabular-nums leading-[1.2]">{services.length}</span>
          <span className="text-[11px] text-zinc-500">Automatic *.nazxf.my.id endpoints</span>
        </div>
      </section>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-[8px] border-b border-b-[var(--color-surface-raised)] mb-[20px] overflow-x-auto">
        <button
          type="button"
          className={`domains-tab-btn inline-flex items-center py-[10px] px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:all_120ms_ease] whitespace-nowrap ${activeTab === "custom" ? "is-active text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#878492] border-b-transparent hover:text-ink-console"}`}
          onClick={() => setActiveTab("custom")}
        >
          <Globe className="w-4 h-4 mr-2" />
          <span>Custom Domains</span>
          <span className="bg-[#22202a] inline-flex items-center justify-center h-[18px] py-0 px-[6px] rounded-[9999px] text-[10px] font-semibold text-[#a19ea8] ml-[6px]">{customDomains.length}</span>
        </button>

        <button
          type="button"
          className={`domains-tab-btn inline-flex items-center py-[10px] px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:all_120ms_ease] whitespace-nowrap ${activeTab === "platform" ? "is-active text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#878492] border-b-transparent hover:text-ink-console"}`}
          onClick={() => setActiveTab("platform")}
        >
          <Server className="w-4 h-4 mr-2" />
          <span>Platform Subdomains</span>
          <span className="bg-[#22202a] inline-flex items-center justify-center h-[18px] py-0 px-[6px] rounded-[9999px] text-[10px] font-semibold text-[#a19ea8] ml-[6px]">{services.length}</span>
        </button>

        <button
          type="button"
          className={`domains-tab-btn inline-flex items-center py-[10px] px-[14px] text-[13px] font-medium bg-transparent border-0 border-b-2 cursor-pointer [transition:all_120ms_ease] whitespace-nowrap ${activeTab === "guide" ? "is-active text-[var(--color-ink)] border-b-[var(--color-accent)]" : "text-[#878492] border-b-transparent hover:text-ink-console"}`}
          onClick={() => setActiveTab("guide")}
        >
          <HelpCircle className="w-4 h-4 mr-2" />
          <span>DNS Setup Guide</span>
        </button>
      </div>

      {/* TAB 1: Custom Domains */}
      {activeTab === "custom" && (
        <section aria-labelledby="custom-domains-heading">
          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-[12px] mb-[16px]">
            <div className="relative w-full max-w-[380px]">
              <Search className="absolute left-[12px] top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-[#706d7e] pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search domains by hostname, service, or project..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="domains-search-input bg-surface w-full h-[36px] py-0 pr-[32px] pl-[36px] rounded-control border border-surface-raised text-ink-console text-[13px]! outline-none [transition:border-color_150ms_ease] focus:border-[var(--color-accent)]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-[10px] top-1/2 -translate-y-1/2 text-[#706d7e] bg-transparent border-0 cursor-pointer p-[2px] flex items-center justify-center hover:text-ink-console"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={filterSelectClass}
                aria-label="Filter domains by status"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active (Verified)</option>
                <option value="pending">Pending DNS</option>
                <option value="failed">Verification Failed</option>
              </select>

              <span className="inline-flex items-center h-[24px] py-0 px-[10px] rounded-[9999px] text-[11px] font-medium bg-[#1d1b22] border border-[#282632] text-[#878492]">{filteredDomains.length} Domains</span>
            </div>
          </div>

          {/* Table Card */}
          <div className="bg-surface border border-surface-raised rounded-panel overflow-hidden">
            {loading && customDomains.length === 0 ? (
              <div className="p-6 space-y-4" aria-label="Loading domains">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="flex items-center gap-3">
                    <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] w-8 h-8 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-4 w-48 rounded" />
                      <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-3 w-32 rounded" />
                    </div>
                    <div className="bg-[#1f1d27] animate-[supabasePulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite] h-6 w-20 rounded" />
                  </div>
                ))}
              </div>
            ) : filteredDomains.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-[56px] px-[20px] text-center">
                <div className="w-[52px] h-[52px] rounded-[50%] bg-[rgba(62,207,142,0.08)] border border-[rgba(62,207,142,0.2)] flex items-center justify-center" aria-hidden="true">
                  <Globe className="w-7 h-7 text-emerald-400" />
                </div>
                <h3 className="text-base font-semibold text-white mt-3">
                  {search ? "No matching custom domains" : "No custom domains added yet"}
                </h3>
                <p className="text-xs text-zinc-400 max-w-md mt-1 mb-5">
                  {search
                    ? `No domain matches the query "${search}". Try resetting the search.`
                    : "Connect your own brand hostname (e.g. app.yourcompany.com) to any Docker service in your organization with automated TLS certificates."}
                </p>
                {canManage && (
                  <button
                    type="button"
                    className="supabase-btn-green"
                    onClick={() => {
                      setAddError("");
                      if (availableServices.length > 0) {
                        setSelectedServiceId(availableServices[0].id);
                      }
                      setAddModalOpen(true);
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    <span>Add Custom Domain</span>
                  </button>
                )}
              </div>
            ) : (
              <table className={domainsTableClass}>
                <thead>
                  <tr>
                    <th scope="col">Domain / Hostname</th>
                    <th scope="col">Target Service</th>
                    <th scope="col">Project</th>
                    <th scope="col">DNS Status</th>
                    <th scope="col">SSL Certificate</th>
                    <th scope="col">Verified At</th>
                    <th scope="col" className="text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDomains.map((dom) => {
                    const isVerifying = verifyingId === dom.id;
                    const isActive = dom.status === "active";
                    const isFailed = dom.status === "failed";
                    const isCertIssued = dom.certificateStatus === "issued";

                    return (
                      <tr key={dom.id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-[30px] h-[30px] rounded-control bg-[#1f1d26] border border-[#2d2a37] flex items-center justify-center shrink-0" aria-hidden="true">
                              <Globe
                                className={`w-3.5 h-3.5 ${isActive ? "text-emerald-400" : "text-zinc-500"}`}
                              />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-white font-mono text-xs">
                                  {dom.hostname}
                                </span>
                                {isActive && (
                                  <a
                                    href={`https://${dom.hostname}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-zinc-500 hover:text-emerald-400 transition-colors"
                                    title="Open live custom domain in new tab"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <span className="text-[11px] text-zinc-500 block">
                                Added {formatDateTime(dom.createdAt)}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td>
                          <Link
                            href={`/dashboard/services/${dom.serviceId}`}
                            className="font-medium text-white hover:text-emerald-400 transition-colors inline-flex items-center gap-1 text-xs"
                          >
                            <span>{dom.serviceName}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                          </Link>
                        </td>

                        <td>
                          <Link
                            href={`/dashboard/projects/${dom.projectId}`}
                            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors inline-flex items-center gap-1"
                          >
                            <Layers className="w-3 h-3 text-zinc-500" />
                            <span>{dom.projectName}</span>
                          </Link>
                        </td>

                        <td>
                          <span
                            className={`domains-status-pill inline-flex items-center gap-[6px] h-[22px] py-0 px-[8px] rounded-[9999px] text-[11px] font-medium ${
                              isActive ? "is-active bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]" : isFailed ? "is-failed bg-[#2d1419] border border-[#4d222a] text-[var(--color-danger)]" : "is-pending bg-[#2a2012] border border-[#48381c] text-[var(--color-warning)]"
                            }`}
                          >
                            <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
                            <span className="capitalize">{dom.status}</span>
                          </span>
                          {dom.lastError ? (
                            <p
                              className="text-[11px] text-rose-400 mt-1 max-w-xs truncate"
                              title={dom.lastError}
                            >
                              {dom.lastError}
                            </p>
                          ) : null}
                        </td>

                        <td>
                          <span
                            className={`domains-cert-pill inline-flex items-center h-[22px] py-0 px-[8px] rounded-control-sm text-[11px] font-medium ${
                              isCertIssued
                                ? "is-issued bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]"
                                : dom.certificateStatus === "failed"
                                  ? "is-failed bg-[#2d1419] border border-[#4d222a] text-[var(--color-danger)]"
                                  : "is-pending bg-[#2a2012] border border-[#48381c] text-[var(--color-warning)]"
                            }`}
                          >
                            <Lock className="w-3 h-3 mr-1" />
                            <span>
                              {isCertIssued
                                ? "TLS Issued"
                                : dom.certificateStatus === "failed"
                                  ? "TLS Failed"
                                  : "Pending TLS"}
                            </span>
                          </span>
                        </td>

                        <td className="text-xs font-mono text-zinc-400">
                          {dom.verifiedAt ? formatDateTime(dom.verifiedAt) : "-"}
                        </td>

                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!isActive && canManage && (
                              <button
                                type="button"
                                className={compactSecondaryButtonClass}
                                onClick={() => void handleVerify(dom)}
                                disabled={isVerifying}
                                title="Check DNS propagation and route domain"
                              >
                                <RotateCw
                                  className={`w-3 h-3 mr-1 ${isVerifying ? "animate-spin" : ""}`}
                                />
                                <span>{isVerifying ? "Checking..." : "Verify DNS"}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              className={`${secondaryButtonClass} text-xs h-7 px-2`}
                              onClick={() => setInstructionsDomain(dom)}
                              title="View required DNS TXT & CNAME records"
                            >
                              <FileText className="w-3 h-3 mr-1" />
                              <span>DNS Records</span>
                            </button>

                            {canManage && (
                              <button
                                type="button"
                                className="inline-flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border border-transparent cursor-pointer [transition:all_120ms_ease] hover:bg-[rgba(244,63,94,0.1)] hover:border-[rgba(244,63,94,0.2)]"
                                onClick={() => setDeletingDomain(dom)}
                                title="Remove custom domain"
                                aria-label={`Delete custom domain ${dom.hostname}`}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-zinc-500 hover:text-rose-400 transition-colors" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* TAB 2: Platform Subdomains */}
      {activeTab === "platform" && (
        <section aria-labelledby="platform-subdomains-heading">
          <div className="mb-4 flex items-start gap-[12px] py-[12px] px-[16px] rounded-card bg-[rgba(6,182,212,0.08)] border border-[rgba(6,182,212,0.25)]">
            <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-cyan-200">
              <strong>Automatic Platform Routing:</strong> Every service deployed on this node is
              immediately reachable on its private HTTPS platform subdomain through the edge proxy,
              with automatic SSL and zero configuration.
            </div>
          </div>

          <div className="bg-surface border border-surface-raised rounded-panel overflow-hidden">
            {services.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-[56px] px-[20px] text-center">
                <Server className="w-7 h-7 text-zinc-600 mb-2" />
                <h3 className="text-base font-semibold text-white">No services found</h3>
                <p className="text-xs text-zinc-400 max-w-md mt-1">
                  Create and deploy a service inside any project to generate automatic subdomains.
                </p>
              </div>
            ) : (
              <table className={domainsTableClass}>
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">Project</th>
                    <th scope="col">Platform Subdomain URL</th>
                    <th scope="col">Edge TLS</th>
                    <th scope="col">Container Port</th>
                    <th scope="col">Service Status</th>
                    <th scope="col" className="text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((srv) => (
                    <tr key={srv.id}>
                      <td>
                        <Link
                          href={`/dashboard/services/${srv.id}`}
                          className="font-semibold text-white hover:text-emerald-400 transition-colors text-xs"
                        >
                          {srv.name}
                        </Link>
                      </td>

                      <td>
                        <Link
                          href={`/dashboard/projects/${srv.projectId}`}
                          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors inline-flex items-center gap-1"
                        >
                          <Layers className="w-3 h-3 text-zinc-500" />
                          <span>{srv.projectName}</span>
                        </Link>
                      </td>

                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-emerald-400">{srv.url}</span>
                          <button
                            type="button"
                            onClick={() => copyText(srv.url, srv.id, "Platform URL")}
                            className="text-zinc-500 hover:text-white transition-colors"
                            title="Copy full URL"
                            aria-label={`Copy URL for ${srv.name}`}
                          >
                            {copiedKey === srv.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td>
                        <span className="domains-cert-pill inline-flex items-center h-[22px] py-0 px-[8px] rounded-control-sm text-[11px] font-medium is-issued">
                          <ShieldCheck className="w-3 h-3 mr-1" />
                          <span>Wildcard Edge TLS</span>
                        </span>
                      </td>

                      <td className="text-xs font-mono text-zinc-400">:{srv.containerPort}</td>

                      <td>
                        <span
                          className={`domains-status-pill inline-flex items-center gap-[6px] h-[22px] py-0 px-[8px] rounded-[9999px] text-[11px] font-medium ${
                            srv.status === "running"
                              ? "is-active bg-[#0f2e21] border border-[#1d4a36] text-[var(--color-accent)]"
                              : srv.status === "failed"
                                ? "is-failed bg-[#2d1419] border border-[#4d222a] text-[var(--color-danger)]"
                                : "is-pending bg-[#2a2012] border border-[#48381c] text-[var(--color-warning)]"
                          }`}
                        >
                          <span className="project-status-dot bg-current w-[6px] h-[6px] rounded-[50%]" aria-hidden="true" />
                          <span className="capitalize">{srv.status}</span>
                        </span>
                      </td>

                      <td className="text-right">
                        <a
                          href={srv.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`${compactSecondaryButtonClass} gap-1`}
                        >
                          <span>Visit</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: DNS Setup Guide */}
      {activeTab === "guide" && (
        <section aria-labelledby="dns-guide-heading" className="space-y-6">
          <div className="bg-surface border border-[var(--color-surface-raised)] rounded-panel p-[24px]">
            <h2 id="dns-guide-heading" className="text-base font-semibold text-white mb-2">
              How Custom Domain Routing Works
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed mb-6">
              Stealth Hosting uses an edge reverse proxy (powered by Caddy) with on-demand automated
              Let&apos;s Encrypt and ZeroSSL certificates. Pointing your custom domain takes less
              than 2 minutes.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Step 1 */}
              <div className="bg-[#131217] border border-[#24222c] rounded-card p-[18px]">
                <div className="bg-[rgba(62,207,142,0.12)] w-[24px] h-[24px] rounded-[50%] border border-[rgba(62,207,142,0.3)] text-accent flex items-center justify-center text-[11px] font-bold mb-[12px]">1</div>
                <h3 className="text-sm font-semibold text-white mb-1">Add Domain to Service</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Click <strong>&ldquo;Add Custom Domain&rdquo;</strong>, select your target
                  service, and enter your bare hostname (e.g. <code>api.example.com</code>).
                </p>
              </div>

              {/* Step 2 */}
              <div className="bg-[#131217] border border-[#24222c] rounded-card p-[18px]">
                <div className="bg-[rgba(62,207,142,0.12)] w-[24px] h-[24px] rounded-[50%] border border-[rgba(62,207,142,0.3)] text-accent flex items-center justify-center text-[11px] font-bold mb-[12px]">2</div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  Publish Ownership TXT Record
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  In your DNS provider (Cloudflare, GoDaddy, Namecheap), create a{" "}
                  <strong>TXT record</strong> at <code>_stealth-verify.&lt;hostname&gt;</code> with
                  the generated token value.
                </p>
              </div>

              {/* Step 3 */}
              <div className="bg-[#131217] border border-[#24222c] rounded-card p-[18px]">
                <div className="bg-[rgba(62,207,142,0.12)] w-[24px] h-[24px] rounded-[50%] border border-[rgba(62,207,142,0.3)] text-accent flex items-center justify-center text-[11px] font-bold mb-[12px]">3</div>
                <h3 className="text-sm font-semibold text-white mb-1">Point CNAME or A Record</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  For subdomains (e.g. <code>api.example.com</code>), add a <strong>CNAME</strong>{" "}
                  pointing to your platform domain. For apex/root domains, add an{" "}
                  <strong>A record</strong> pointing to the platform edge IP.
                </p>
              </div>

              {/* Step 4 */}
              <div className="bg-[#131217] border border-[#24222c] rounded-card p-[18px]">
                <div className="bg-[rgba(62,207,142,0.12)] w-[24px] h-[24px] rounded-[50%] border border-[rgba(62,207,142,0.3)] text-accent flex items-center justify-center text-[11px] font-bold mb-[12px]">4</div>
                <h3 className="text-sm font-semibold text-white mb-1">Verify &amp; Auto-SSL</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Click <strong>&ldquo;Verify DNS&rdquo;</strong>. Once DNS resolves, the edge proxy
                  provisions the route and issues an SSL certificate automatically with zero
                  downtime.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MODAL 1: Add Custom Domain */}
      {addModalOpen && (
        <ModalDialog labelledBy="add-domain-title" onClose={() => setAddModalOpen(false)}>
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px]">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              <h2 id="add-domain-title">Add Custom Domain</h2>
            </div>
            <button
              type="button"
              className={modalCloseClass}
              onClick={() => setAddModalOpen(false)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleAddDomain}>
            <div className="supabase-modal-body space-y-4">
              {addError && (
                <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
                  {addError}
                </div>
              )}

              {availableServices.length === 0 ? (
                <div className="p-4 rounded-lg bg-amber-950/20 border border-amber-900/40 text-amber-200 text-xs">
                  All deployed services in this organization already have a custom domain assigned.
                  Each service supports 1 custom domain.
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="service-select" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                      Target Service:
                    </label>
                    <select
                      id="service-select"
                      value={selectedServiceId}
                      onChange={(e) => setSelectedServiceId(e.target.value)}
                      className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms]"
                      required
                    >
                      {availableServices.map((srv) => (
                        <option key={srv.id} value={srv.id}>
                          {srv.name} ({srv.projectName})
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-zinc-500 mt-1 block">
                      Incoming requests to this domain will route directly to this service.
                    </span>
                  </div>

                  <div>
                    <label htmlFor="hostname-input" className="block text-[13px] font-medium text-[#c9c7d2] mb-[6px]">
                      Domain Name / Hostname:
                    </label>
                    <input
                      id="hostname-input"
                      type="text"
                      placeholder="e.g. app.mycompany.com"
                      value={newHostname}
                      onChange={(e) => setNewHostname(e.target.value)}
                      required
                      className="supabase-modal-input w-full h-[38px] py-0 px-[12px] rounded-control bg-[#1a1920] text-ink outline-none [transition:border-color_150ms] font-mono"
                      autoFocus
                    />
                    <span className="text-[11px] text-zinc-500 mt-1 block">
                      Enter a bare hostname without <code>https://</code> or trailing slashes.
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="supabase-modal-footer">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setAddModalOpen(false)}
                disabled={busyAdd}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="supabase-btn-green"
                disabled={busyAdd || availableServices.length === 0 || !newHostname.trim()}
              >
                {busyAdd ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Adding...
                  </>
                ) : (
                  "Add Domain"
                )}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}

      {/* MODAL 2: DNS Instructions */}
      {instructionsDomain && (
        <ModalDialog
          labelledBy="instructions-title"
          onClose={() => setInstructionsDomain(null)}
          className="max-w-xl"
        >
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px]">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              <h2 id="instructions-title" className="font-mono text-sm">
                DNS Setup for {instructionsDomain.hostname}
              </h2>
            </div>
            <button
              type="button"
              className={modalCloseClass}
              onClick={() => setInstructionsDomain(null)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="supabase-modal-body space-y-4">
            <p className="text-xs text-zinc-400">
              Add these DNS records at your DNS host (Cloudflare, AWS Route 53, Namecheap, etc.) to
              verify ownership and route traffic:
            </p>

            {/* Record 1: TXT Record */}
            <div className="bg-[#131217] p-[14px] rounded-card border border-surface-raised">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
                <div className="flex items-center gap-2">
                  <span className={dnsRecordTagClass}>TXT</span>
                  <span className="text-xs font-semibold text-white">Ownership Verification</span>
                </div>
                <span className="text-[11px] text-zinc-500">Required</span>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-[11px] text-zinc-500 block">Record Name / Host:</span>
                  <div className="flex items-center justify-between p-2 rounded bg-zinc-950/50 border border-zinc-800">
                    <code className="text-xs font-mono text-zinc-200 break-all">
                      {instructionsDomain.instructions.txt.name}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(instructionsDomain.instructions.txt.name, "txt-name", "TXT Host")
                      }
                      className="text-zinc-500 hover:text-white ml-2 flex-shrink-0"
                      title="Copy TXT Host"
                    >
                      {copiedKey === "txt-name" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] text-zinc-500 block">Record Value / Content:</span>
                  <div className="flex items-center justify-between p-2 rounded bg-zinc-950/50 border border-zinc-800">
                    <code className="text-xs font-mono text-emerald-400 break-all">
                      {instructionsDomain.instructions.txt.value}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(instructionsDomain.instructions.txt.value, "txt-val", "TXT Value")
                      }
                      className="text-zinc-500 hover:text-white ml-2 flex-shrink-0"
                      title="Copy TXT Value"
                    >
                      {copiedKey === "txt-val" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Record 2: CNAME or A Record */}
            <div className="bg-[#131217] p-[14px] rounded-card border border-surface-raised">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800 mb-2">
                <div className="flex items-center gap-2">
                  <span className={dnsRecordTagClass}>CNAME</span>
                  <span className="text-xs font-semibold text-white">Traffic Routing</span>
                </div>
                <span className="text-[11px] text-zinc-500">Required</span>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-[11px] text-zinc-500 block">Record Name / Host:</span>
                  <div className="flex items-center justify-between p-2 rounded bg-zinc-950/50 border border-zinc-800">
                    <code className="text-xs font-mono text-zinc-200">
                      {instructionsDomain.instructions.cname.name}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          instructionsDomain.instructions.cname.name,
                          "cname-name",
                          "CNAME Host",
                        )
                      }
                      className="text-zinc-500 hover:text-white ml-2 flex-shrink-0"
                      title="Copy CNAME Host"
                    >
                      {copiedKey === "cname-name" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] text-zinc-500 block">Target / Points To:</span>
                  <div className="flex items-center justify-between p-2 rounded bg-zinc-950/50 border border-zinc-800">
                    <code className="text-xs font-mono text-emerald-400">
                      {instructionsDomain.instructions.cname.value}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          instructionsDomain.instructions.cname.value,
                          "cname-val",
                          "CNAME Target",
                        )
                      }
                      className="text-zinc-500 hover:text-white ml-2 flex-shrink-0"
                      title="Copy CNAME Target"
                    >
                      {copiedKey === "cname-val" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {instructionsDomain.instructions.a.value && (
                  <div className="pt-1">
                    <span className="text-[11px] text-zinc-500 block">
                      Or for Apex/Root domains, use an <strong>A Record</strong> pointing to:
                    </span>
                    <code className="text-xs font-mono text-cyan-400 mt-0.5 inline-block">
                      {instructionsDomain.instructions.a.value}
                    </code>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="supabase-modal-footer">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setInstructionsDomain(null)}
            >
              Close
            </button>
            {canManage && (
              <button
                type="button"
                className="supabase-btn-green"
                onClick={() => void handleVerify(instructionsDomain)}
                disabled={verifyingId === instructionsDomain.id}
              >
                {verifyingId === instructionsDomain.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Checking DNS...
                  </>
                ) : (
                  "Verify Propagation Now"
                )}
              </button>
            )}
          </div>
        </ModalDialog>
      )}

      {/* MODAL 3: Delete Domain Confirmation */}
      {deletingDomain && (
        <ModalDialog labelledBy="delete-domain-title" onClose={() => setDeletingDomain(null)}>
          <div className="supabase-modal-header flex items-center justify-between py-[18px] px-[20px] border-rose-900/40">
            <div className="flex items-center gap-2 text-rose-400">
              <Trash2 className="w-4 h-4" />
              <h2 id="delete-domain-title">Disconnect Custom Domain</h2>
            </div>
            <button
              type="button"
              className={modalCloseClass}
              onClick={() => setDeletingDomain(null)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="supabase-modal-body space-y-3">
            {deleteError && (
              <div className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
                {deleteError}
              </div>
            )}
            <p className="text-xs text-zinc-300 leading-relaxed">
              Are you sure you want to delete <strong>{deletingDomain.hostname}</strong>? Its
              routing rules and TLS certificate status on the edge proxy will be removed
              immediately.
            </p>
            <p className="text-xs text-zinc-500">
              The target service <strong>{deletingDomain.serviceName}</strong> will continue serving
              normally on its platform subdomain.
            </p>
          </div>

          <div className="supabase-modal-footer">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setDeletingDomain(null)}
              disabled={busyDelete}
            >
              Cancel
            </button>
            <button
              type="button"
              className={dangerButtonClass}
              onClick={() => void handleDeleteDomain()}
              disabled={busyDelete}
            >
              {busyDelete ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  Deleting...
                </>
              ) : (
                "Delete Domain"
              )}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
