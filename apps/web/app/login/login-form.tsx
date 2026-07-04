"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

const inputClasses =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-500 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-400";

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
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
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          Doodle Note
        </Link>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
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
            className={inputClasses}
          />
        )}
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClasses}
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClasses}
        />

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending
            ? "Please wait…"
            : mode === "sign-in"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      {googleEnabled && (
        <button
          type="button"
          onClick={() =>
            authClient.signIn.social({ provider: "google", callbackURL: "/app" })
          }
          className="mt-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Continue with Google
        </button>
      )}

      <p className="mt-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {mode === "sign-in" ? (
          <>
            No account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("sign-up");
                setError(null);
              }}
              className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
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
              className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
