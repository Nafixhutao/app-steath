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
          <span className="supabase-service-breadcrumb-current text-[#ededf2]">Not found</span>
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
          <Link className="svc-back-link inline-block mt-[16px] text-[13px] no-underline" href="/dashboard/projects">
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
        <span className="supabase-service-breadcrumb-current text-[#ededf2]">{service.name}</span>
      </p>

      <header className="grid gap-[10px] min-w-0 pb-[20px]">
        <div className="flex items-center gap-[12px] flex-wrap">
          <h1 className="supabase-service-title m-0 text-[24px] text-left">{service.name}</h1>
          <span className={`supabase-service-status is-${service.status}`}>
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

      <nav className="svc-tabbar items-center gap-[4px] border-b border-b-[#27272a] mb-[24px] overflow-x-auto" aria-label="Service sections" ref={tabbarRef}>
        {TABS.map((entry) => {
          // Read-only Members do not get the management tabs.
          const hidden = (entry.id === "environment" || entry.id === "settings") && !canManage;
          if (hidden) return null;
          return (
            <button
              key={entry.id}
              type="button"
              className={`svc-tab${tab === entry.id ? " is-active" : ""}`}
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
            <section className="dashboard-section mt-[26px]" aria-labelledby="configuration-heading">
              <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
                <h2 id="configuration-heading">Configuration</h2>
              </div>
              <dl className="service-meta grid gap-[10px] mt-[16px] mb-0 mx-0 p-0">
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
              className="dashboard-section mt-[26px] organization-danger-zone"
              aria-labelledby="danger-heading"
            >
              <div className="dashboard-section-heading flex min-h-[42px] items-center justify-between border-b border-b-[#322f37]">
                <h2 id="danger-heading">Danger zone</h2>
              </div>
              <p>
                Deleting this Service stops its container and removes its Volume, Environment
                Variables, and Domains.
              </p>
              <form className="organization-settings-form flex gap-[12px] py-[18px] px-0" onSubmit={remove}>
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
                  className="supabase-btn-danger inline-flex items-center justify-center gap-[8px] min-h-[38px] py-[8px] px-[16px] rounded-card border-0 bg-[#e11d48] [background-image:linear-gradient(180deg,var(--color-danger)_0%,#e11d48_100%)] text-ink text-[13.5px]! font-semibold! [box-shadow:0_1px_2px_rgba(0,0,0,0.25)] [transition:filter_140ms_ease,transform_100ms_ease] [&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#fb7185_0%,var(--color-danger)_100%)] [&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1] disabled:transform-none disabled:[box-shadow:none]"
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
