"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { EyeMark, authSubmitClass } from "@/components/auth-form";

/** The two reset-password form states the /forgot-password flow walks through:
 * requesting the link (by email) and answering it (token from the URL). */

function BrandHeading({ title }: { title: string }) {
  return (
    <>
      <div className="brand-mark flex justify-center h-[56px] w-[56px] mt-0 mb-[24px] mx-auto">
        <Image src="/stealth-cat.png" alt="Stealth" width={56} height={56} priority className="w-[56px] h-[56px] object-contain" />
      </div>
      <h1 className="text-center">{title}</h1>
    </>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) {
      setIsError(true);
      setNotice("Enter the email you registered with.");
      return;
    }

    setIsLoading(true);
    setNotice("");
    setIsError(false);

    const redirectTo = `${window.location.origin}/reset-password`;
    const result = await authClient.requestPasswordReset({ email, redirectTo });

    setIsLoading(false);
    if (result.error) {
      setIsError(true);
      setNotice(result.error.message || "Could not start the reset. Please try again.");
      return;
    }

    setNotice(
      "If the address is registered, a reset link has been generated. Email delivery is not configured yet, so ask the administrator to hand you the link from the server log.",
    );
  }

  return (
    <main className="auth-page [@media(max-width:480px)]:pt-[40px] [@media(max-width:480px)]:pb-[40px] min-h-[100dvh] flex flex-col items-center py-[56px] px-[16px] bg-[#0a0a0a] text-[#d9d9d9]">
      <a className="skip-link text-[var(--color-canvas)] fixed top-[16px] left-[16px] z-[10] py-[8px] px-[12px] rounded-control bg-[#eaeaea] focus-visible:outline-2 focus-visible:outline-[#4693ff] focus-visible:outline-offset-[2px]" href="#reset-content">
        Skip to content
      </a>

      <div id="reset-content" className="login-content w-[min(100%,364px)] m-auto">
        <BrandHeading title="Reset your password" />
        <p className="auth-lead mt-[8px] mb-[20px] mx-0 text-[#999999] text-[13.5px] leading-[1.6]">
          Enter the email you registered with and a one-hour reset link will be generated for that
          account.
        </p>

        <p
          className={isError ? "mt-3 py-2 px-3 border border-[#880c02] rounded-card bg-[#3b0501] text-[#fd9087] text-[12.5px] leading-4" : notice ? "mt-3 py-2 px-3 border border-[#904506] rounded-card bg-[#2a1502] text-[#f79847] text-[12.5px] leading-4" : "sr-only"}
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>

        <form className="auth-fields grid gap-[18px]" onSubmit={handleSubmit} noValidate>
          <div className="auth-field grid gap-[7px]">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <button type="submit" className={authSubmitClass} disabled={isLoading}>
            {isLoading ? "Generating link..." : "Send reset link"}
          </button>
        </form>

        <p className="support-copy mt-[20px] mb-0 mx-0 text-[#999999] text-[13.5px] leading-[20px] text-center">
          Back to <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}

/** The /reset-password route: fully static shell, token streamed via the query. */
export function ResetPasswordForm() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordTokenReader />
    </Suspense>
  );
}

function ResetPasswordTokenReader() {
  const token = useSearchParams().get("token") ?? "";
  return <ResetPasswordTokenForm token={token} />;
}

function ResetPasswordTokenForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  if (!token) {
    return (
      <main className="auth-page [@media(max-width:480px)]:pt-[40px] [@media(max-width:480px)]:pb-[40px] min-h-[100dvh] flex flex-col items-center py-[56px] px-[16px] bg-[#0a0a0a] text-[#d9d9d9]">
        <div className="login-content w-[min(100%,364px)] m-auto">
          <BrandHeading title="Reset link invalid" />
          <p className="auth-lead mt-[8px] mb-[20px] mx-0 text-[#999999] text-[13.5px] leading-[1.6]">
            This reset link is missing its token or it has expired. Request a fresh one and try
            again within the hour.
          </p>
          <p className="support-copy mt-[20px] mb-0 mx-0 text-[#999999] text-[13.5px] leading-[20px] text-center">
            <Link href="/forgot-password">Request a new reset link</Link> ·{" "}
            <Link href="/login">Sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setIsError(true);
      setNotice("The new password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);
    setNotice("");
    setIsError(false);

    const result = await authClient.resetPassword({ newPassword: password, token });

    setIsLoading(false);
    if (result.error) {
      setIsError(true);
      setNotice(result.error.message || "The reset failed. Request a new link and try again.");
      return;
    }

    setNotice("Password updated. You can sign in with the new password now.");
  }

  return (
    <main className="auth-page [@media(max-width:480px)]:pt-[40px] [@media(max-width:480px)]:pb-[40px] min-h-[100dvh] flex flex-col items-center py-[56px] px-[16px] bg-[#0a0a0a] text-[#d9d9d9]">
      <a className="skip-link text-[var(--color-canvas)] fixed top-[16px] left-[16px] z-[10] py-[8px] px-[12px] rounded-control bg-[#eaeaea] focus-visible:outline-2 focus-visible:outline-[#4693ff] focus-visible:outline-offset-[2px]" href="#reset-content">
        Skip to content
      </a>

      <div id="reset-content" className="login-content w-[min(100%,364px)] m-auto">
        <BrandHeading title="Set a new password" />
        <p className="auth-lead mt-[8px] mb-[20px] mx-0 text-[#999999] text-[13.5px] leading-[1.6]">Choose a password of at least 8 characters for this account.</p>

        <p
          className={isError ? "mt-3 py-2 px-3 border border-[#880c02] rounded-card bg-[#3b0501] text-[#fd9087] text-[12.5px] leading-4" : notice ? "mt-3 py-2 px-3 border border-[#904506] rounded-card bg-[#2a1502] text-[#f79847] text-[12.5px] leading-4" : "sr-only"}
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>

        <form className="auth-fields grid gap-[18px]" onSubmit={handleSubmit} noValidate>
          <div className="auth-field grid gap-[7px]">
            <label htmlFor="password">New password</label>
            <div className="password-wrap relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={isLoading}
              />
              <button
                type="button"
                className="password-toggle focus-visible:outline-2 focus-visible:outline-[#4693ff] focus-visible:outline-offset-[2px] absolute top-1/2 right-[6px] flex w-[32px] h-[32px] items-center justify-center -translate-y-1/2 border-0 rounded-control bg-transparent text-[#999999] cursor-pointer hover:text-[#eaeaea]"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={isLoading}
              >
                <EyeMark hidden={showPassword} />
              </button>
            </div>
          </div>
          <button type="submit" className={authSubmitClass} disabled={isLoading}>
            {isLoading ? "Updating..." : "Update password"}
          </button>
        </form>

        <p className="support-copy mt-[20px] mb-0 mx-0 text-[#999999] text-[13.5px] leading-[20px] text-center">
          <Link href="/login">Back to Sign in</Link>
        </p>
      </div>
    </main>
  );
}
