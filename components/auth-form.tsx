"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";
import { safeReturnTo } from "@/lib/return-to";

export type AuthFormMode = "signin" | "signup";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="flex-none w-[16px] h-[16px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.16 7.16 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="flex-none w-[16px] h-[16px] github-mark" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function LockMark() {
  return (
    <svg viewBox="0 0 24 24" className="small-icon w-[14px] h-[14px]" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function EyeMark({ hidden = false }: { hidden?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="small-icon w-[14px] h-[14px]" aria-hidden="true">
      {hidden ? (
        <>
          <path d="m3 3 18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
          <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 8.8 4 10 8-.4 1.3-1.2 2.7-2.3 3.8M6.2 6.2C4.5 7.4 3 9.5 2 12c1.2 4 5 8 10 8 1.7 0 3.2-.4 4.5-1.1" />
        </>
      ) : (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="check-icon w-[13px] h-[13px]" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

/**
 * The sign-in and sign-up form, shared by the /login and /signup pages so each
 * has its own URL, title, and field set instead of one toggle at the root.
 * The social buttons reflect what the instance actually has credentials for:
 * configured providers are live and redirect through better-auth, unconfigured
 * ones keep the honest "Coming soon" disabled state.
 */
export function AuthForm({ initialMode }: { initialMode: AuthFormMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(true);
  const [notice, setNotice] = useState("");
  const isSignUp = initialMode === "signup";
  const [isLoading, setIsLoading] = useState(false);
  const [socialProviders, setSocialProviders] = useState<{
    google: boolean;
    github: boolean;
  } | null>(null);
  const [socialBusy, setSocialBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth-providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.data?.providers) setSocialProviders(payload.data.providers);
      })
      .catch(() => {
        // Unknown stays "Coming soon": the honest default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function socialSignIn(provider: "google" | "github") {
    setSocialBusy(provider);
    const returnTo =
      safeReturnTo(new URLSearchParams(window.location.search).get("returnTo")) ??
      "/dashboard/organizations";
    try {
      const result = await signIn.social({
        provider,
        callbackURL: returnTo,
        errorCallbackURL: "/login",
      });
      if (result?.error) {
        setNotice(result.error.message || `Could not start sign in with ${provider}.`);
        setSocialBusy(null);
      }
      // No error means better-auth redirects the browser to the provider.
    } catch {
      setNotice(`Could not start sign in with ${provider}.`);
      setSocialBusy(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const requestedReturnTo = new URLSearchParams(window.location.search).get("returnTo");
    const returnTo = safeReturnTo(requestedReturnTo) ?? "/dashboard/organizations";

    if (!email || !password) {
      setNotice("Enter your email and password to continue.");
      return;
    }

    if (isSignUp && !username) {
      setNotice("Username is required for sign up.");
      return;
    }

    setIsLoading(true);
    setNotice("");

    try {
      if (isSignUp) {
        const result = await signUp.email({
          email,
          password,
          name: username,
          username,
          callbackURL: returnTo,
        });

        if (result.error) {
          setNotice(result.error.message || "Sign up failed. Please try again.");
        } else {
          setNotice("Signed up! Redirecting to organizations...");
          router.push(returnTo);
        }
      } else {
        const result = await signIn.email({
          email,
          password,
          rememberMe: rememberEmail,
          callbackURL: returnTo,
        });

        if (result.error) {
          setNotice(result.error.message || "Invalid credentials. Please try again.");
        } else {
          setNotice("Signed in successfully! Redirecting...");
          router.push(returnTo);
        }
      }
    } catch (error) {
      console.error("Auth error:", error);
      setNotice("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-page [@media(max-width:480px)]:pt-[40px] [@media(max-width:480px)]:pb-[40px] min-h-[100dvh] flex flex-col items-center py-[56px] px-[16px] bg-[#0a0a0a] text-[#d9d9d9]">
      <a className="skip-link text-[var(--color-canvas)] fixed top-[16px] left-[16px] z-[10] py-[8px] px-[12px] rounded-control bg-ink focus-visible:outline-2 focus-visible:outline-[#186cee] focus-visible:outline-offset-[2px]" href="#login-content">
        Skip to content
      </a>

      <div id="login-content" className="login-content w-[min(100%,364px)] m-auto">
        <div className="brand-mark flex justify-center h-[56px] w-[56px] mt-0 mb-[24px] mx-auto">
          <Image src="/stealth-cat.png" alt="Stealth" width={56} height={56} priority className="w-[56px] h-[56px] object-contain" />
        </div>

        <h1>{isSignUp ? "Sign up" : "Sign in to Stealth"}</h1>

        {/* Google, GitHub, dan SSO tinggal hidup setelah admin menyimpan
            kredensialnya di panel Settings: tombol yang terkonfigurasi
            mengalihkan lewat better-auth, yang belum tetap "Coming soon"
            supaya tidak ada kontrol setengah jalan. */}
        <div className="grid grid-cols-2 gap-[10px] mt-[24px]">
          <button
            type="button"
            className="secondary-button text-[13.5px] font-medium focus-visible:outline-2 focus-visible:outline-[#186cee] focus-visible:outline-offset-[2px] flex h-[40px] items-center justify-center gap-[8px] border border-[#333338] rounded-card bg-[var(--color-canvas)] text-[#f2f2f3] cursor-pointer hover:border-[#4a4a50] hover:bg-[#1c1c1c] disabled:cursor-not-allowed disabled:border-[#2b2b30] disabled:bg-[#121214] disabled:text-[#8b8b92] active:translate-y-[1px] active:scale-[0.99]"
            disabled={!socialProviders?.google || socialBusy === "google"}
            onClick={() => socialSignIn("google")}
          >
            <GoogleMark />
            Google
            {!socialProviders?.google ? <span className="provider-soon text-[10px] font-medium text-[#8b8b92] tracking-[0.02em]">Coming soon</span> : null}
          </button>
          <button
            type="button"
            className="secondary-button text-[13.5px] font-medium focus-visible:outline-2 focus-visible:outline-[#186cee] focus-visible:outline-offset-[2px] flex h-[40px] items-center justify-center gap-[8px] border border-[#333338] rounded-card bg-[var(--color-canvas)] text-[#f2f2f3] cursor-pointer hover:border-[#4a4a50] hover:bg-[#1c1c1c] disabled:cursor-not-allowed disabled:border-[#2b2b30] disabled:bg-[#121214] disabled:text-[#8b8b92] active:translate-y-[1px] active:scale-[0.99]"
            disabled={!socialProviders?.github || socialBusy === "github"}
            onClick={() => socialSignIn("github")}
          >
            <GitHubMark />
            GitHub
            {!socialProviders?.github ? <span className="provider-soon text-[10px] font-medium text-[#8b8b92] tracking-[0.02em]">Coming soon</span> : null}
          </button>
        </div>

        <button type="button" className="secondary-button text-[13.5px] font-medium focus-visible:outline-2 focus-visible:outline-[#186cee] focus-visible:outline-offset-[2px] flex h-[40px] items-center justify-center gap-[8px] border border-[#333338] rounded-card bg-[var(--color-canvas)] text-[#f2f2f3] cursor-pointer hover:border-[#4a4a50] hover:bg-[#1c1c1c] disabled:cursor-not-allowed disabled:border-[#2b2b30] disabled:bg-[#121214] disabled:text-[#8b8b92] active:translate-y-[1px] active:scale-[0.99] w-full mt-[10px]" disabled>
          <LockMark />
          Continue with SSO
          <span className="provider-soon text-[10px] font-medium text-[#8b8b92] tracking-[0.02em]">Coming soon</span>
        </button>

        <p className={notice ? "notice" : "sr-only"} role="status" aria-live="polite">
          {notice}
        </p>

        <div className="divider flex items-center gap-[12px] my-[20px] mx-0 text-[#8b8b92] text-[11px] font-medium tracking-[0.08em]" aria-hidden="true">
          <span className="h-[1px] flex-1 bg-[#26262b]" />
          OR
          <span className="h-[1px] flex-1 bg-[#26262b]" />
        </div>

        <form className="auth-fields grid gap-[18px]" onSubmit={handleSubmit} noValidate>
          {isSignUp && (
            <div className="auth-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                disabled={isLoading}
              />
            </div>
          )}

          <div className="auth-field">
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

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <div className="password-wrap relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={isLoading}
              />
              <button
                type="button"
                className="password-toggle focus-visible:outline-2 focus-visible:outline-[#186cee] focus-visible:outline-offset-[2px] absolute top-1/2 right-[6px] flex w-[32px] h-[32px] items-center justify-center -translate-y-1/2 border-0 rounded-control bg-transparent text-[#9a9aa2] cursor-pointer hover:text-ink"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={isLoading}
              >
                <EyeMark hidden={showPassword} />
              </button>
            </div>
          </div>

          {!isSignUp && (
            <label className="remember-row text-ink text-[13.5px] leading-[16px] items-center gap-[10px] mt-[24px] cursor-pointer select-none">
              <input
                className="sr-only"
                type="checkbox"
                checked={rememberEmail}
                onChange={(event) => setRememberEmail(event.target.checked)}
                disabled={isLoading}
              />
              <span className="checkbox-mark flex w-[18px] h-[18px] flex-none items-center justify-center border-2 border-[#186cee] rounded-[5px] bg-[#186cee]" aria-hidden="true">
                {rememberEmail ? <CheckMark /> : null}
              </span>
              Keep me signed in on this device
            </label>
          )}

          <button type="submit" className="submit-button disabled:cursor-not-allowed disabled:opacity-[0.65] focus-visible:outline-2 focus-visible:outline-[#186cee] focus-visible:outline-offset-[2px] cursor-pointer text-[14px] font-semibold hover:[filter:brightness(1.1)] w-full h-[40px] mt-[24px] border-0 rounded-card [background:linear-gradient(180deg,#2e83f7_0%,#186cee_48%,#0e5cd6_100%)] text-ink active:translate-y-[1px] active:scale-[0.99]" disabled={isLoading}>
            {isLoading ? "Please wait..." : isSignUp ? "Sign up" : "Sign in"}
          </button>
        </form>

        <p className="support-copy mt-[20px] mb-0 mx-0 text-[#b3b3ba] text-[13.5px] leading-[20px] text-center">
          {isSignUp ? "Already signed up?" : "New to Stealth?"}{" "}
          <Link href={isSignUp ? "/login" : "/signup"}>{isSignUp ? "Sign in" : "Sign up"}</Link>
        </p>
        {!isSignUp && (
          <p className="support-copy mt-[20px] mb-0 mx-0 text-[#b3b3ba] text-[13.5px] leading-[20px] text-center compact">
            Forgot your password? <Link href="/forgot-password">Reset it</Link>
          </p>
        )}
      </div>
    </main>
  );
}
