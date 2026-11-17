import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/password-reset-forms";

export const metadata: Metadata = {
  title: "Set a new password · Stealth Hosting",
  description: "Choose a new password for your Stealth Hosting account.",
};

/**
 * Step two of the reset flow: better-auth's /api/auth/reset-password/:token
 * callback redirects here with the token in the query. The client component
 * reads the token with useSearchParams, so this page prerenders fully static
 * and never touches runtime data on the server.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
