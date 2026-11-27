"use client";

import { useState, type ReactNode } from "react";
import { Bell, Check, Gauge, KeyRound, Mail, Settings2 } from "lucide-react";
import {
  AdminHeader,
  AdminPageBody,
  AdminPanel,
  AdminPanelHeader,
} from "@/features/admin/components/admin-panel";
import { SignInProvidersPanel } from "@/features/admin/settings/sign-in-providers-panel";
import { Switch } from "@/components/motion/switch";
import { EmailProvidersContent } from "./email-providers-panel";

/**
 * Cloudflare-style Settings surface. It composes the Forge panels from
 * `features/admin/**` without editing them (ADR-0008) and adds tabbed
 * navigation, the familiar orange active state, and the new Email providers
 * section in one place.
 */

const fieldClass =
  "h-10 w-full rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 text-[13px] leading-4 text-[var(--projects-text)] outline-none transition-colors focus:border-[var(--projects-accent)]";
const labelClass = "mb-1.5 block text-[12px] font-medium text-[var(--projects-muted)]";

type TabId = "general" | "telemetry" | "alerting" | "providers" | "email";

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "general", label: "General", icon: <Settings2 size={14} /> },
  { id: "telemetry", label: "Telemetry", icon: <Gauge size={14} /> },
  { id: "alerting", label: "Alerting", icon: <Bell size={14} /> },
  { id: "providers", label: "Sign-in providers", icon: <KeyRound size={14} /> },
  { id: "email", label: "Email providers", icon: <Mail size={14} /> },
];

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-3.5 py-3">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        ariaLabel={label}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-[var(--projects-text)]">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-[var(--projects-muted)]">{description}</p>
      </div>
    </div>
  );
}

export function CloudflareSettingsPage() {
  const [tab, setTab] = useState<TabId>("general");
  const [platformName, setPlatformName] = useState("Stealth Cloud Platform");
  const [supportEmail, setSupportEmail] = useState("ops@stealth.dev");
  const [region, setRegion] = useState("sgp-1");
  const [traceSampling, setTraceSampling] = useState("10%");
  const [logRetention, setLogRetention] = useState("7 days");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slackAlerts, setSlackAlerts] = useState(false);
  const [saved, setSaved] = useState(false);

  function markSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <AdminPageBody>
      <AdminHeader
        title="Settings"
        subtitle="Instance preferences, telemetry, sign-in, and transactional email. Email provider changes apply immediately."
      >
        {tab === "general" || tab === "telemetry" || tab === "alerting" ? (
          <button type="button" onClick={markSaved} className="inline-flex h-[34px] items-center gap-[8px] border border-[var(--projects-accent-border)] rounded-control bg-[var(--projects-accent-strong)] py-0 px-[14px] text-ink text-[12.5px]! font-semibold! [transition:filter_120ms_ease] [&:hover:not(:disabled)]:[filter:brightness(1.12)] disabled:opacity-[0.5]">
            {saved ? <Check size={14} aria-hidden="true" /> : null}
            {saved ? "Saved" : "Save changes"}
          </button>
        ) : null}
      </AdminHeader>

      <div className="flex gap-[4px] overflow-x-auto border-b border-b-[var(--projects-border)] mb-[20px]" role="tablist" aria-label="Settings sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className="cf-tab inline-flex items-center gap-2"
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label}>
        {tab === "general" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <AdminPanel>
              <AdminPanelHeader title="General" subtitle="How this instance presents itself." />
              <div className="space-y-3.5">
                <label className="block">
                  <span className={labelClass}>Platform name</span>
                  <input
                    value={platformName}
                    onChange={(event) => setPlatformName(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Support email</span>
                  <input
                    type="email"
                    value={supportEmail}
                    onChange={(event) => setSupportEmail(event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
            </AdminPanel>

            <AdminPanel>
              <AdminPanelHeader title="Region" subtitle="Default region for new resources." />
              <label className="block">
                <span className={labelClass}>Primary region</span>
                <select
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  aria-label="Primary region"
                  className={fieldClass}
                >
                  <option value="sgp-1">sgp-1 (Singapore)</option>
                  <option value="us-east-1">us-east-1 (Virginia)</option>
                  <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                </select>
              </label>
            </AdminPanel>
          </div>
        )}

        {tab === "telemetry" && (
          <AdminPanel>
            <AdminPanelHeader
              title="Telemetry"
              subtitle="Sampling and retention for traces and logs."
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Trace sampling</span>
                <select
                  value={traceSampling}
                  onChange={(event) => setTraceSampling(event.target.value)}
                  aria-label="Trace sampling"
                  className={fieldClass}
                >
                  {["1%", "5%", "10%", "25%", "100%"].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Log retention</span>
                <select
                  value={logRetention}
                  onChange={(event) => setLogRetention(event.target.value)}
                  aria-label="Log retention"
                  className={fieldClass}
                >
                  {["24 hours", "7 days", "14 days", "30 days"].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </AdminPanel>
        )}

        {tab === "alerting" && (
          <AdminPanel>
            <AdminPanelHeader
              title="Alerting"
              subtitle="Where incidents and degradations notify the on-call."
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow
                label="Email alerts"
                description="Email on-call for critical incidents."
                checked={emailAlerts}
                onChange={setEmailAlerts}
              />
              <ToggleRow
                label="Slack alerts"
                description="Post incident updates to #platform-alerts."
                checked={slackAlerts}
                onChange={setSlackAlerts}
              />
            </div>
          </AdminPanel>
        )}

        {tab === "providers" && <SignInProvidersPanel />}

        {tab === "email" && <EmailProvidersContent />}
      </div>
    </AdminPageBody>
  );
}
