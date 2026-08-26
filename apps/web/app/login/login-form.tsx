"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import {
  BrandLockup,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "../ui";

type Mode = "sign-in" | "sign-up";

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginForm({
  googleEnabled,
  microsoftEnabled,
  next = "/app",
}: {
  googleEnabled: boolean;
  microsoftEnabled: boolean;
  next?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
      return;
    }
    router.push(next);
    router.refresh();
  }

  /**
   * Social sign-in with visible failure: without this, an endpoint error or
   * blocked redirect leaves the button silently dead (bit us inside the iOS
   * app's sign-in sheet).
   */
  async function handleSocial(provider: "microsoft" | "google") {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: next,
      });
      if (result.error) {
        const detail =
          result.error.message ??
          ("code" in result.error && typeof result.error.code === "string"
            ? result.error.code
            : null);
        setError(detail ?? "Sign-in failed. Try again.");
        setPending(false);
        return;
      }
      // Success normally navigates away; if we're still here after a beat,
      // re-enable the buttons rather than leaving the form stuck.
      setTimeout(() => setPending(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandLockup
          href="/"
          layout="stacked"
          iconSize={48}
          wordmarkSize="text-xl"
          priority
        />
        <p className="mt-2 text-sm text-stone">
          {mode === "sign-in"
            ? "Sign in to your workspace"
            : "Create your account"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {mode === "sign-up" && (
          <label className="text-xs font-medium text-bark">
            Name
            <input
              type="text"
              required
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </label>
        )}
        <label className="text-xs font-medium text-bark">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs font-medium text-bark">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className={`mt-1 ${buttonPrimary}`}>
          {pending
            ? "Please wait…"
            : mode === "sign-in"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      {microsoftEnabled && (
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSocial("microsoft")}
          className={`mt-3 w-full ${buttonSecondary}`}
        >
          <MicrosoftLogo />
          Sign in with Microsoft
        </button>
      )}

      {googleEnabled && (
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSocial("google")}
          className={`mt-3 w-full ${buttonSecondary}`}
        >
          <GoogleLogo />
          Continue with Google
        </button>
      )}

      <p className="mt-6 text-center text-sm text-stone">
        {mode === "sign-in" ? (
          <>
            No account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("sign-up");
                setError(null);
              }}
              className="underline underline-offset-2 hover:text-ink"
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("sign-in");
                setError(null);
              }}
              className="underline underline-offset-2 hover:text-ink"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
