import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/password-reset-forms";

export const metadata: Metadata = {
  title: "Reset password · Stealth Hosting",
  description: "Request a password reset link for your Stealth Hosting account.",
};

/** Step one of the reset flow: generate the one-hour reset link for an email. */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
