import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "Sign in · Stealth Hosting",
  description: "Sign in to Stealth Hosting to deploy and manage your services.",
};

/** The dedicated sign-in page, so login has its own address and tab title. */
export default function LoginPage() {
  return <AuthForm initialMode="signin" />;
}
