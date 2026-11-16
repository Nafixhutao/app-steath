"use client";

import { useEffect, useState, type FormEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { components } from "@/lib/admin/api-schema";
import type { IncidentSeverity } from "../types/incidents";

const fieldClass =
  "h-10 w-full rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 text-[13px] leading-4 text-[var(--projects-text)] outline-none transition-colors focus:border-[var(--projects-border-hover)]";
const labelClass =
  "mb-1.5 block text-[12px] font-medium text-[var(--projects-muted)]";

const SEVERITIES: IncidentSeverity[] = ["critical", "warning", "info"];
const SERVICES = [
  "API",
  "Database",
  "Redis",
  "Agent Worker",
  "Sandbox Service",
  "[OI]",
  "Anthropic",
  "Gateway",
];

/**
 * "Create incident" dialog — opens a real investigating incident through the
 * admin incidents API.
 */
export function CreateIncidentDialog({
  open,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (
    input: components["schemas"]["CreateAdminIncidentRequest"],
  ) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("warning");
  const [services, setServices] = useState<string[]>(["API"]);
  const [message, setMessage] = useState("");
  const [titleError, setTitleError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verbatim from stealth-forge
    setTitle("");
    setSeverity("warning");
    setServices(["API"]);
    setMessage("");
    setTitleError(undefined);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toggleService = (service: string, checked: boolean) => {
    setServices((prev) =>
      checked
        ? [...new Set([...prev, service])]
        : prev.filter((item) => item !== service),
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError("Title is required.");
      return;
    }
    void onSubmit({
      title: title.trim(),
      severity:
        severity as components["schemas"]["CreateAdminIncidentRequest"]["severity"],
      status:
        "investigating" as components["schemas"]["CreateAdminIncidentRequest"]["status"],
      services: services.length > 0 ? services : ["API"],
      message:
        message.trim() || "Incident opened manually from the admin console.",
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:px-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-incident-title"
        className="relative w-full rounded-t-[10px] border border-[var(--projects-border)] bg-[var(--projects-card-bg)] shadow-2xl shadow-black/40 sm:max-w-[520px] sm:rounded-[10px]"
      >
        <div className="flex items-start gap-3 border-b border-[var(--projects-divider)] px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] text-[var(--projects-warning)]">
            <TriangleAlert size={17} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="create-incident-title"
              className="m-0 text-[16px] font-semibold leading-5 text-[var(--projects-text)]"
            >
              Create incident
            </h2>
            <p className="m-0 mt-0.5 text-[13px] leading-5 text-[var(--projects-muted)]">
              Opens a new investigating incident on the board.
            </p>
          </div>
        </div>

        <form
          id="create-incident-form"
          onSubmit={handleSubmit}
          className="space-y-4 px-5 py-4"
          noValidate
        >
          <label className="block">
            <span className={labelClass}>Title</span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (titleError) setTitleError(undefined);
              }}
              autoFocus
              placeholder="e.g. Elevated sandbox provision failures"
              aria-invalid={!!titleError}
              className={cn(
                fieldClass,
                titleError && "border-[var(--projects-danger)]",
              )}
            />
            {titleError && (
              <span className="mt-1 block text-[12px] text-[var(--projects-danger)]">
                {titleError}
              </span>
            )}
          </label>

          <label className="block">
            <span className={labelClass}>Severity</span>
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as IncidentSeverity)
              }
              aria-label="Severity"
              className={cn(fieldClass, "appearance-none")}
            >
              {SEVERITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="m-0 border-0 p-0">
            <legend className={labelClass}>Affected services</legend>
            <div className="flex flex-wrap gap-2">
              {SERVICES.map((service) => {
                const checked = services.includes(service);
                return (
                  <label
                    key={service}
                    className={cn(
                      "inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                      checked
                        ? "border-[var(--projects-accent)] bg-[color-mix(in_srgb,var(--projects-accent)_12%,transparent)] text-[var(--projects-text)]"
                        : "border-[var(--projects-border)] text-[var(--projects-muted)] hover:border-[var(--projects-border-hover)]",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(event) =>
                        toggleService(service, event.target.checked)
                      }
                    />
                    {checked ? "✓" : "+"} {service}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <span className={labelClass}>Initial update</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              placeholder="What are you seeing?"
              className="w-full resize-none rounded-md border border-[var(--projects-border)] bg-[var(--projects-control)] px-3 py-2 text-[13px] leading-5 text-[var(--projects-text)] outline-none transition-colors placeholder:text-[var(--projects-muted)] focus:border-[var(--projects-border-hover)]"
            />
          </label>

          {error ? (
            <p
              className="m-0 text-[12px] text-[var(--projects-danger)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--projects-divider)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-md border border-[var(--projects-border)] px-4 text-[13px] font-medium text-[var(--projects-text)] transition-colors hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-incident-form"
            disabled={pending}
            className="inline-flex h-10 items-center rounded-[10px] border border-[var(--projects-accent-border)] bg-[var(--projects-accent-strong)] px-4 text-[13px] font-semibold leading-none text-white transition-colors hover:bg-[var(--projects-accent-hover)] disabled:opacity-60"
          >
            {pending ? "Opening…" : "Open Incident"}
          </button>
        </div>
      </div>
    </div>
  );
}
