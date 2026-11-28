"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveMember } from "@/lib/auth-client";
import { getProject } from "@/lib/projects-client";
import {
  deleteService,
  getService,
  serviceStatusLabel,
  type ServiceSummary,
} from "@/lib/services-client";
import { getError, useResource } from "@/lib/resource";
import { DeploymentsPanel } from "./deployments-panel";
import { EnvironmentPanel } from "./environment-panel";
import { CustomDomainPanel } from "./custom-domain-panel";
import { RuntimePanel } from "./runtime-panel";
import { VolumePanel } from "./volume-panel";

import { serviceMetaClass } from "@/components/ui-classes";

export const serviceTabbarClass = [
  "svc-tabbar flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  "[@media(max-width:640px)]:gap-[0] [@media(max-width:640px)]:mb-[20px] items-center gap-[4px]",
  "border-b border-b-[#27272a] mb-[24px] overflow-x-auto [-webkit-overflow-scrolling:touch]",
  "[@media(max-width:640px)]:[scroll-snap-type:x_proximity]",
  "[@media(max-width:640px)]:text-[13px]",
].join(" ");

export const deleteServiceConfirmClass = [
  "cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-danger)]",
  "focus-visible:outline-offset-[2px] disabled:opacity-[0.5] disabled:cursor-not-allowed",
  "inline-flex items-center justify-center gap-[8px] min-h-[38px] py-[8px] px-[16px]",
  "rounded-card border-0 bg-[#e11d48]",
  "[background-image:linear-gradient(180deg,var(--color-danger)_0%,#e11d48_100%)] text-ink",
  "text-[13.5px]! font-semibold! [box-shadow:0_1px_2px_rgba(0,0,0,0.25)]",
  "[transition:filter_140ms_ease,transform_100ms_ease]",
  "[&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#fb7185_0%,var(--color-danger)_100%)]",
  "[&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1]",
  "disabled:transform-none disabled:[box-shadow:none]",
].join(" ");

export const breadcrumbCurrentClass = [
  "[@media(max-width:600px)]:min-w-0 [@media(max-width:600px)]:max-w-[100%]",
  "[@media(max-width:600px)]:overflow-hidden [@media(max-width:600px)]:text-ellipsis",
  "[@media(max-width:600px)]:whitespace-nowrap text-[#ededf2]",
].join(" ");

const TABS = [
  { id: "deployments", label: "Deployments" },
  { id: "environment", label: "Environment" },
  { id: "domains", label: "Domains" },
  { id: "runtime", label: "Runtime" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * The header shows `owner/repo`, not the raw URL: a template URL may point at a
 * deep, percent-encoded folder, which is too long for a single line and is
 * already listed in Settings. Anything that is not an absolute URL falls back
 * to the raw value.
 */
function repoLabel(repoUrl: string): string {
  try {
    const segments = new URL(repoUrl).pathname.split("/").filter(Boolean);
    if (segments.length >= 2) return `${segments[0]}/${segments[1]}`;
  } catch {
    // Not an absolute URL; fall through to the raw value.
  }
  return repoUrl;
}

// Service status pill palette. The dot inherits `currentColor`, so one colour
// pair per state is enough.
function statusPillTone(status: string) {
  if (status === "running")
    return "bg-[rgba(0,176,107,0.12)] text-[#00e08c] before:animate-[service-status-pulse_2s_ease-in-out_infinite]";
  if (status === "deploying" || status === "building") return "bg-[rgba(245,158,11,0.12)] text-[#f5a623]";
  if (status === "failed" || status === "suspended") return "bg-[rgba(239,68,68,0.12)] text-[#f87171]";
  return "bg-[#27272a] text-[#d4d4d8]";
}

export function ServiceDetail({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const { data: activeMember } = useActiveMember();
  const [tab, setTab] = useState<TabId>("deployments");
  const tabbarRef = useRef<HTMLElement | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  // Delete failures share one slot next to the load error.
  const [actionError, setActionError] = useState("");
  // Better Auth stores multiple roles as a comma-separated string, so check the
  // parsed set rather than the raw value.
  const canManage =
    activeMember?.role
      .split(",")
      .some((role) => role.trim() === "owner" || role.trim() === "admin") ?? false;
  // Members are read-only for resources but may still trigger a Deployment.
  const canDeploy = Boolean(activeMember?.role);

  // On narrow screens the tab strip scrolls sideways; keep the selected tab in
  // view without moving the page vertically.
  useEffect(() => {
    tabbarRef.current
      ?.querySelector<HTMLElement>(".svc-tab.is-active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const panel = useResource(async () => {
    const service = await getService(serviceId);
    // The Project name only decorates the breadcrumb; a failure here must not
    // hide the Service itself.
    const projectName = await getProject(service.projectId)
      .then((project) => project.name)
      .catch(() => "");
    return { service, projectName };
  }, [serviceId]);
  const service: ServiceSummary | null = panel.data?.service ?? null;
  const projectName = panel.data?.projectName ?? "";
  const loading = panel.loading;
  const error = panel.error;

  // Flag the strip only while tabs remain off-screen, which drives the fade
  // hint at its trailing edge.
  useEffect(() => {
    const tabbar = tabbarRef.current;
    if (!tabbar) return;
    const update = () => {
      const more = tabbar.scrollWidth - tabbar.clientWidth - tabbar.scrollLeft > 2;
      tabbar.dataset.overflow = more ? "true" : "false";
    };
    update();
    tabbar.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(tabbar);
    return () => {
      tabbar.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [service?.id, canManage]);

  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!service) return;
    setBusy(true);
    setActionError("");
    try {
      await deleteService(service.id, confirmation);
      router.push(`/dashboard/projects/${service.projectId}`);
    } catch (cause) {
      setActionError(getError(cause));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-content supabase-service-page">
        <div className="flex items-center gap-[10px] py-[40px] px-0 text-[#71717a] text-[13px]" role="status">
          <span className="w-[14px] h-[14px] border-2 border-[#3f3f46] border-t-[#ededf2] rounded-[50%] animate-[svc-spin_0.7s_linear_infinite]" aria-hidden="true" />
          Loading Service...
        </div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="dashboard-content supabase-service-page">
        <p className="supabase-service-breadcrumb flex items-center flex-wrap gap-[8px] mt-0 mb-[20px] mx-0 text-ink-muted text-[13px]">
          <Link href="/dashboard/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span className={breadcrumbCurrentClass}>Not found</span>
        </p>
        <div className="py-[48px] px-[32px] border border-[#27272a] rounded-card bg-[#0c0c0d]">
          <h1 className="supabase-service-title m-0 text-[24px] text-left">Service not found</h1>
          <p className="mt-[4px] mb-0 mx-0 text-ink-muted text-[14px]">
            This Service does not exist in the active Organization.
          </p>
          {error || actionError ? (
            <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
              {error || actionError}
            </p>
          ) : null}
          <Link className="text-ink-muted hover:text-[#ededf2] inline-block mt-[16px] text-[13px] no-underline" href="/dashboard/projects">
            ← Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content supabase-service-page">
      <p className="supabase-service-breadcrumb flex items-center flex-wrap gap-[8px] mt-0 mb-[20px] mx-0 text-ink-muted text-[13px]">
        <Link href="/dashboard/projects">Projects</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/dashboard/projects/${service.projectId}`}>{projectName || "Project"}</Link>
        <span aria-hidden="true">/</span>
        <span className={breadcrumbCurrentClass}>{service.name}</span>
      </p>

      <header className="grid gap-[10px] min-w-0 pb-[20px]">
        <div className="flex items-center gap-[12px] flex-wrap">
          <h1 className="supabase-service-title m-0 text-[24px] text-left">{service.name}</h1>
          <span className={`supabase-service-status inline-flex shrink-0 items-center gap-[7px] py-[3px] px-[10px] rounded-[999px] text-[12px] font-medium before:content-[''] before:w-[6px] before:h-[6px] before:rounded-[50%] before:bg-current is-${service.status} ${statusPillTone(service.status)}`}>
            {serviceStatusLabel(service.status)}
          </span>
        </div>
        <div className="flex items-center flex-wrap gap-[8px_14px] min-w-0 text-ink-muted text-[13px]">
          <a
            className="svc-url-link inline-flex items-center gap-[6px] min-w-0 max-w-[100%] text-[13px] no-underline border-b border-b-[#3f3f46] pb-[1px] hover:border-b-ink-muted"
            href={service.url}
            target="_blank"
            rel="noreferrer"
            title={`Open ${service.platformHostname}`}
          >
            <span className="[overflow-wrap:anywhere]">{service.platformHostname}</span>
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              aria-hidden="true"
              className="svc-url-icon text-ink-muted"
            >
              <path
                d="M6 3h7v7M13 3L7.5 8.5M9 13H3V7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <span className="svc-meta-item inline-flex items-center gap-[6px] min-w-0 max-w-[100%]" title={service.repoUrl}>
            <code className="inline-block max-w-[100%] overflow-hidden text-ellipsis whitespace-nowrap align-bottom">{repoLabel(service.repoUrl)}</code>
            <span className="shrink-0 text-ink-muted">@{service.branch}</span>
          </span>
          <span className="svc-meta-item inline-flex items-center gap-[6px] min-w-0 max-w-[100%] text-ink-muted">
            {service.cpuLimit} vCPU · {service.memoryLimitMb} MB RAM
          </span>
        </div>
      </header>

      {error || actionError ? (
        <p className="dashboard-alert py-[12px] px-[14px] border border-[#48434d] rounded-card text-ink-console text-[13px] is-error" role="alert">
          {error || actionError}
        </p>
      ) : null}

      <nav className={serviceTabbarClass} aria-label="Service sections" ref={tabbarRef}>
        {TABS.map((entry) => {
          // Read-only Members do not get the management tabs.
          const hidden = (entry.id === "environment" || entry.id === "settings") && !canManage;
          if (hidden) return null;
          return (
            <button
              key={entry.id}
              type="button"
              className={`svc-tab relative pt-[10px] pr-[14px] pb-[12px] pl-[14px] border-0 bg-transparent text-[var(--color-ink-muted)] text-[14px] font-medium whitespace-nowrap cursor-pointer [transition:color_0.15s_ease] hover:text-[#ededf2] focus-visible:outline-2 focus-visible:outline-[#fafafa] focus-visible:outline-offset-[-2px] [@media(max-width:640px)]:min-h-[44px] [@media(max-width:640px)]:px-[8px] [@media(max-width:640px)]:snap-start ${tab === entry.id ? " text-[#fafafa] after:absolute after:left-[10px] after:right-[10px] after:-bottom-px after:h-[2px] after:rounded-t-[2px] after:bg-[#fafafa] after:content-[''] [@media(max-width:640px)]:after:left-[4px] [@media(max-width:640px)]:after:right-[4px] is-active" : ""}`}
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {tab === "deployments" ? (
          <DeploymentsPanel serviceId={service.id} canDeploy={canDeploy} canManage={canManage} />
        ) : null}

        {tab === "environment" && canManage ? (
          <EnvironmentPanel serviceId={service.id} needsRedeploy={service.needsRedeploy} />
        ) : null}

        {tab === "domains" ? (
          <CustomDomainPanel serviceId={service.id} canManage={canManage} />
        ) : null}

        {tab === "runtime" ? (
          <>
            <RuntimePanel
              serviceId={service.id}
              canManage={canManage}
              hostname={service.platformHostname}
            />
            {canManage ? (
              <VolumePanel
                serviceId={service.id}
                needsRedeploy={service.needsRedeploy}
                canManage={canManage}
              />
            ) : null}
          </>
        ) : null}

        {tab === "settings" && canManage ? (
          <>
            <section className="dashboard-section mt-0 mb-[24px] mx-0 p-[20px] border border-[#27272a] rounded-card bg-[#0c0c0d] [@media(max-width:600px)]:p-[16px]" aria-labelledby="configuration-heading">
              <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
                <h2 id="configuration-heading">Configuration</h2>
              </div>
              <dl className={serviceMetaClass}>
                <div>
                  <dt>Repository</dt>
                  <dd>
                    {service.repoUrl} @ {service.branch}
                  </dd>
                </div>
                <div>
                  <dt>Dockerfile</dt>
                  <dd>{service.dockerfilePath}</dd>
                </div>
                <div>
                  <dt>Container port</dt>
                  <dd>{service.containerPort}</dd>
                </div>
                <div>
                  <dt>Health path</dt>
                  <dd>{service.healthPath ?? "None"}</dd>
                </div>
                <div>
                  <dt>Platform Subdomain</dt>
                  <dd>{service.platformHostname}</dd>
                </div>
                <div>
                  <dt>Resource limits</dt>
                  <dd>
                    {service.cpuLimit} vCPU · {service.memoryLimitMb} MB RAM
                  </dd>
                </div>
              </dl>
            </section>

            <section
              className="dashboard-section organization-danger-zone border mt-0 mb-[24px] mx-0 p-[20px] border-[#27272a] rounded-card bg-[#0c0c0d] [@media(max-width:600px)]:p-[16px] border-[rgba(239,68,68,0.3)]"
              aria-labelledby="danger-heading"
            >
              <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
                <h2 id="danger-heading">Danger zone</h2>
              </div>
              <p>
                Deleting this Service stops its container and removes its Volume, Environment
                Variables, and Domains.
              </p>
              <form className="organization-settings-form [@media(max-width:760px)]:flex-col grid gap-[14px] mt-0 mb-[16px] mx-0 p-[16px] border border-[#27272a] rounded-card bg-[#111113] last:mb-[0]" onSubmit={remove}>
                <label>
                  Type <strong>{service.name}</strong> to confirm
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                <button
                  className={deleteServiceConfirmClass}
                  type="submit"
                  disabled={busy || confirmation !== service.name}
                >
                  {busy ? "Deleting..." : "Delete Service"}
                </button>
              </form>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
