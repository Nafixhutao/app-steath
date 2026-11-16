"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { AdminHeader, AdminPageBody } from "../components/admin-panel";
import { AdminPanel, AdminPanelHeader } from "../components/admin-panel";
import { SignInProvidersPanel } from "./sign-in-providers-panel";
import { Switch } from "@/components/motion/switch";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-10 w-full rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 text-[13px] leading-4 text-[var(--projects-text)] outline-none transition-colors focus:border-[var(--projects-border-hover)]";
const labelClass =
  "mb-1.5 block text-[12px] font-medium text-[var(--projects-muted)]";

/** Settings — admin configuration form. Local state only; nothing persists. */
export function SettingsPage() {
  const [platformName, setPlatformName] = useState("Stealth Cloud Platform");
  const [supportEmail, setSupportEmail] = useState("ops@stealth.dev");
  const [region, setRegion] = useState("sgp-1");
  const [traceSampling, setTraceSampling] = useState("10%");
  const [logRetention, setLogRetention] = useState("7 days");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [slackAlerts, setSlackAlerts] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <AdminPageBody>
      <AdminHeader
        title="Settings"
        subtitle="Console preferences and telemetry configuration. Sign-in providers apply immediately."
      >
        <button
          type="button"
          onClick={handleSave}
          className={
            saved
              ? "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-accent)] bg-[color-mix(in_srgb,var(--projects-accent)_14%,transparent)] px-3.5 text-[12.5px] font-semibold text-[var(--projects-accent)]"
              : "inline-flex h-9 items-center rounded-lg border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--projects-accent-hover)]"
          }
        >
          {saved ? (
            <>
              <Check size={14} strokeWidth={2.2} aria-hidden="true" />
              Saved
            </>
          ) : (
            "Save changes"
          )}
        </button>
      </AdminHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminPanel>
          <AdminPanelHeader title="General" />
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
            <label className="block">
              <span className={labelClass}>Primary region</span>
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                aria-label="Primary region"
                className={cn(fieldClass, "appearance-none")}
              >
                <option value="sgp-1">sgp-1 (Singapore)</option>
                <option value="us-east-1">us-east-1 (Virginia)</option>
                <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
              </select>
            </label>
          </div>
        </AdminPanel>

        <AdminPanel>
          <AdminPanelHeader title="Telemetry" />
          <div className="space-y-3.5">
            <label className="block">
              <span className={labelClass}>Trace sampling</span>
              <select
                value={traceSampling}
                onChange={(event) => setTraceSampling(event.target.value)}
                aria-label="Trace sampling"
                className={cn(fieldClass, "appearance-none")}
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
                className={cn(fieldClass, "appearance-none")}
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

        <AdminPanel className="lg:col-span-2">
          <AdminPanelHeader
            title="Alerting"
            subtitle="Where incidents and degradations notify the on-call."
          />
          <div className="grid gap-2 sm:grid-cols-3">
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

        <SignInProvidersPanel />
      </div>
    </AdminPageBody>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--projects-border)] bg-[var(--projects-control)] px-3.5 py-3 transition-colors hover:border-[var(--projects-border-hover)]">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        ariaLabel={label}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5 text-[var(--projects-text)]">
          {label}
        </span>
        <span className="block text-[11.5px] leading-4 text-[var(--projects-muted)]">
          {description}
        </span>
      </span>
    </div>
  );
}
