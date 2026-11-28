import Link from "next/link";
import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import { Card, CardActions, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSetupSummary, AdminSetupStepId } from "@/lib/platform/admin-onboarding";

/**
 * Welcome + "Get set up" block on the Admin Overview. Deliberately a plain
 * server component: the summary is read once per visit, so there is no client
 * query to keep in sync. CTA buttons reuse the customer console's blue
 * `.supabase-btn-green` so admin and customer actions look like one product.
 */

type SetupStepCopy = {
  title: string;
  description: string;
  cta: string;
  href: string;
};

const STEP_COPY: Record<AdminSetupStepId, SetupStepCopy> = {
  abuse: {
    title: "Review abuse reports",
    description:
      "New and triaged reports stay open until someone resolves them. Clear the queue so nothing sits unreviewed.",
    cta: "Open abuse reports",
    href: "/admin/abuse-reports",
  },
  email: {
    title: "Configure email providers",
    description:
      "Transactional email goes through Resend with Mailjet as the fallback. Store credentials and a From address.",
    cta: "Configure email",
    href: "/admin/settings",
  },
  oauth: {
    title: "Connect OAuth providers",
    description:
      "GitHub and Google sign-in need client credentials. Stored credentials apply on the next control-plane restart.",
    cta: "Connect OAuth",
    href: "/admin/providers",
  },
};

function SetupStep({
  index,
  step,
  last,
}: {
  index: number;
  step: AdminSetupSummary["steps"][number];
  last: boolean;
}) {
  const copy = STEP_COPY[step.id];

  return (
    <li className="relative flex gap-3.5 pb-6 last:pb-0 sm:gap-4 sm:pb-7">
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[15px] top-9 w-px bg-[var(--projects-border)]"
        />
      )}
      <span
        className={
          step.completed
            ? "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-[#2c4a3c] bg-[#142019] text-[#4ade80]"
            : "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--projects-border-hover)] bg-[var(--projects-card-bg)] text-[13px] font-medium text-[var(--projects-muted)]"
        }
        aria-hidden="true"
      >
        {step.completed ? <Check size={15} strokeWidth={2.4} /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-[15px] font-semibold leading-6 tracking-[-0.01em] text-[var(--projects-text)]">
          {/* Completion is also announced for screen readers, since the check
              icon itself is decorative. */}
          <span className="sr-only">{step.completed ? "Done: " : "To do: "}</span>
          {copy.title}
        </h3>
        <p className="m-0 mt-1 text-[13.5px] leading-6 text-[var(--projects-muted)]">
          {copy.description}
        </p>
        <Link href={copy.href} className="supabase-btn-green mt-3">
          {copy.cta}
          <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

export function AdminWelcome({ name, summary }: { name: string; summary: AdminSetupSummary }) {
  const percent = summary.total === 0 ? 0 : Math.round((summary.completed / summary.total) * 100);

  return (
    <section className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pt-4 sm:px-6 sm:pt-5 lg:px-7">
      <header>
        <h1 className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.03em] text-[var(--projects-text)] sm:text-[32px] sm:leading-10">
          Welcome, {name}
        </h1>
        <p className="m-0 mt-1.5 text-[14px] leading-6 text-[var(--projects-muted)]">
          Review what needs attention and finish platform setup.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Get set up</CardTitle>
          <CardActions>
            <span className="text-[13px] font-medium tabular-nums text-[var(--projects-muted)]">
              {summary.completed}/{summary.total} complete
            </span>
          </CardActions>
        </CardHeader>

        <CardContent className="p-4 sm:p-5">
          <div
            role="progressbar"
            aria-label="Platform setup progress"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={summary.completed}
            aria-valuetext={`${summary.completed} of ${summary.total} steps complete`}
            className="h-2 overflow-hidden rounded-full bg-[var(--projects-border)]"
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(180deg,#3c87ff_0%,#056dff_100%)] transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          <dl className="m-0 mt-4 flex flex-wrap gap-x-8 gap-y-3 sm:gap-x-10">
            <div>
              <dt className="text-[13px] leading-5 text-[var(--projects-muted)]">Organizations</dt>
              <dd className="m-0 mt-0.5 text-[18px] font-medium leading-6 tabular-nums text-[var(--projects-text)]">
                {summary.organizations.toLocaleString("en-US")}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] leading-5 text-[var(--projects-muted)]">Services</dt>
              <dd className="m-0 mt-0.5 text-[18px] font-medium leading-6 tabular-nums text-[var(--projects-text)]">
                {summary.services.toLocaleString("en-US")}
              </dd>
            </div>
          </dl>

          <ol className="m-0 mt-6 list-none p-0">
            {summary.steps.map((step, index) => (
              <SetupStep
                key={step.id}
                index={index}
                step={step}
                last={index === summary.steps.length - 1}
              />
            ))}
          </ol>

          <div className="mt-1 flex gap-3 rounded-lg border border-[var(--projects-border)] bg-[#0f0f0f] p-3 sm:p-3.5">
            <ShieldCheck
              size={17}
              strokeWidth={1.8}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-[var(--projects-muted)]"
            />
            <div className="min-w-0">
              <p className="m-0 text-[13.5px] font-semibold leading-5 text-[var(--projects-text)]">
                Admin actions are audited
              </p>
              <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-5 text-[var(--projects-muted)]">
                <li>Provider secrets are encrypted at rest and never returned by the API.</li>
                <li>Suspensions, incidents, and provider changes are recorded in the audit log.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
