"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { buttonPrimary, buttonSecondary, inputClass, Wordmark } from "../ui";

type Mode = "sign-in" | "sign-up";

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
        setError(result.error.message ?? "Sign-in failed. Try again.");
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
        <Link href="/" className="flex flex-col items-center gap-3">
          <Image
            src="/mascot.png"
            alt=""
            width={48}
            height={48}
            className="rounded-xl"
            priority
            unoptimized
          />
          <Wordmark size="text-xl" />
        </Link>
        <p className="mt-2 text-sm text-stone">
          {mode === "sign-in"
            ? "Sign in to your workspace"
            : "Create your account"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {mode === "sign-up" && (
          <input
            type="text"
            required
            autoComplete="name"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        )}
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

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
