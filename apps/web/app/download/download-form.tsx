"use client";

import Link from "next/link";
import { useState } from "react";

import {
  DOWNLOAD_PLATFORM_LABELS,
  DOWNLOAD_PLATFORMS,
  MARKETING_CONSENT_TEXT,
  type DownloadPlatform,
} from "@/lib/download-consent";

import { AppleLogo, WindowsLogo } from "../logos";
import { buttonPrimary, inputClass } from "../ui";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "started"; downloadUrl: string }
  | { kind: "error"; message: string };

const FALLBACK_ERROR = "We couldn't start your download right now. Please try again.";

const REQUIREMENTS: Record<DownloadPlatform, string> = {
  mac: "Apple Silicon Macs",
  win: "Windows 10/11 (64-bit) · public beta",
};

const NEXT_STEP: Record<DownloadPlatform, string> = {
  mac: "Open the downloaded DMG and drag DoodleNote into Applications.",
  win: "Run the downloaded installer. Windows may ask you to confirm the beta app.",
};

function PlatformLogo({ platform }: { platform: DownloadPlatform }) {
  return platform === "mac" ? (
    <AppleLogo className="-mt-0.5 h-4 w-4" />
  ) : (
    <WindowsLogo className="h-3.5 w-3.5" />
  );
}

export function DownloadForm({ initialPlatform }: { initialPlatform: DownloadPlatform }) {
  const [platform, setPlatform] = useState<DownloadPlatform>(initialPlatform);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [emailValid, setEmailValid] = useState(false);
  const [consented, setConsented] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "submitting") return;

    const form = new FormData(event.currentTarget);
    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/download-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          platform,
          marketingConsent: consented,
          website: form.get("website"),
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: unknown;
        downloadUrl?: unknown;
      } | null;
      if (!response.ok || typeof result?.downloadUrl !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : FALLBACK_ERROR);
      }
      setState({ kind: "started", downloadUrl: result.downloadUrl });
      window.location.assign(result.downloadUrl);
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : FALLBACK_ERROR,
      });
    }
  }

  if (state.kind === "started") {
    return (
      <div
        className="rounded-xl border border-sand bg-card p-5 shadow-[0_12px_32px_-24px_rgba(38,40,31,0.35)] sm:p-7"
        role="status"
        aria-live="polite"
      >
        <p className="font-display text-xl font-semibold text-ink">
          Your download is starting.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-bark">{NEXT_STEP[platform]}</p>
        <a href={state.downloadUrl} className={`mt-6 ${buttonPrimary}`}>
          <PlatformLogo platform={platform} />
          Download again
        </a>
        <p className="mt-6 text-sm leading-relaxed text-stone">
          Want your notes on every device? Cloud Sync is optional and can be
          added any time from the app.{" "}
          <Link href="/pricing" className="font-medium text-sage-deep hover:underline">
            About Cloud Sync
          </Link>
        </p>
      </div>
    );
  }

  const pending = state.kind === "submitting";
  const ready = emailValid && consented;

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-sand bg-card p-5 shadow-[0_12px_32px_-24px_rgba(38,40,31,0.35)] sm:p-7"
    >
      <fieldset>
        <legend className="text-sm font-medium text-ink">Platform</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {DOWNLOAD_PLATFORMS.map((option) => (
            <label
              key={option}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-sage-deep ${
                platform === option
                  ? "border-sage bg-sage-fill text-ink"
                  : "border-sand bg-card text-bark hover:bg-sage-fill"
              }`}
            >
              <input
                type="radio"
                name="platform"
                value={option}
                checked={platform === option}
                onChange={() => setPlatform(option)}
                className="sr-only"
              />
              <PlatformLogo platform={option} />
              <span className="flex flex-col">
                <span className="font-medium">{DOWNLOAD_PLATFORM_LABELS[option]}</span>
                <span className="text-xs text-stone">{REQUIREMENTS[option]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-5 block text-sm font-medium text-ink" htmlFor="email">
        Email
        <input
          className={`mt-1.5 ${inputClass}`}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder="you@example.com"
          required
          onChange={(event) =>
            setEmailValid(event.currentTarget.value.trim() !== "" && event.currentTarget.validity.valid)
          }
        />
      </label>

      <label className="mt-5 flex items-start gap-2.5 text-sm leading-relaxed text-bark" htmlFor="marketingConsent">
        <input
          id="marketingConsent"
          name="marketingConsent"
          type="checkbox"
          required
          checked={consented}
          onChange={(event) => setConsented(event.currentTarget.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-sage-deep"
        />
        <span>{MARKETING_CONSENT_TEXT}</span>
      </label>

      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        className={`mt-6 w-full ${buttonPrimary} disabled:cursor-not-allowed disabled:hover:opacity-50`}
        disabled={pending || !ready}
        aria-describedby={ready ? undefined : "download-requirements"}
      >
        <PlatformLogo platform={platform} />
        {pending ? "Starting download…" : `Download for ${platform === "mac" ? "macOS" : "Windows"}`}
      </button>

      <p
        className={`mt-3 min-h-5 text-sm ${state.kind === "error" ? "text-red-700 dark:text-red-300" : "text-stone"}`}
        role={state.kind === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {state.kind === "error" ? (
          state.message
        ) : ready ? null : (
          <span id="download-requirements">Enter your email and tick the box to download.</span>
        )}
      </p>
      <p className="text-xs leading-relaxed text-stone">
        We store your email with this download request and send DoodleNote
        emails to it. Every email has an unsubscribe link. See our{" "}
        <Link href="/privacy" className="underline decoration-stone/50 underline-offset-2 hover:text-ink">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
