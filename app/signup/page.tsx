import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "Sign up · Stealth Hosting",
  description: "Create a Stealth Hosting account to deploy your first service.",
};

/** The dedicated sign-up page, reachable directly and linked from /login. */
export default function SignupPage() {
  return <AuthForm initialMode="signup" />;
}
