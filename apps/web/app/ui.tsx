import Image from "next/image";
import Link from "next/link";

import { AppleLogo, WindowsLogo } from "./logos";

/**
 * Version-independent: /download/<platform> reads the live platform download
 * manifest and redirects to the current installer, so these can never go stale.
 * The Windows website manifest remains separate from its production updater.
 */
export const DOWNLOADS = {
  mac: "/download/mac",
  win: "/download/win",
};

export const GITHUB_REPO = "https://github.com/Onyx-Dev-Labs/doodle-note";
export const ONYX_URL = "https://onyxdev.io";

/* Shared control styles — keep every page speaking the same visual language. */
export const inputClass =
  "w-full rounded-lg border border-sand bg-card px-3 py-2 text-sm text-ink placeholder:text-stone focus-visible:border-sage focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep";

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-cream transition-opacity hover:opacity-85 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep";

export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-sand bg-card px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sage-fill disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep";

export const navLinkClass =
  "rounded-md px-3 py-1.5 text-sm font-medium text-bark transition-colors hover:bg-sage-fill hover:text-ink";

export const navPillClass =
  "rounded-md border border-sand bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill";

export function Wordmark({ size = "text-lg" }: { size?: string }) {
  return (
    <span className={`${size} font-display font-bold tracking-tight`}>
      <span className="text-ink">Doodle</span>
      <span className="text-sage">Note</span>
    </span>
  );
}

function BuilderAttribution({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={`whitespace-nowrap font-normal leading-none tracking-normal text-stone ${
        compact ? "text-[11px]" : "text-xs"
      }`}
    >
      built by{" "}
      <a
        href={ONYX_URL}
        className="rounded-[2px] text-bark underline decoration-bark/60 underline-offset-2 transition hover:text-sage-deep hover:decoration-sage-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep"
        rel="noreferrer"
        target="_blank"
      >
        Onyx Dev Labs
      </a>
    </p>
  );
}

/** Logo, wordmark, and builder attribution — matches other Onyx product sites. */
export function BrandLockup({
  compact = false,
  priority = false,
}: {
  compact?: boolean;
  priority?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <Link href="/" className="flex items-center gap-2.5">
        <Image
          src="/mascot.png"
          alt=""
          width={compact ? 30 : 34}
          height={compact ? 30 : 34}
          className="rounded-lg"
          priority={priority}
          unoptimized
        />
        <Wordmark size={compact ? "text-base" : "text-lg"} />
      </Link>
      <BuilderAttribution compact={compact} />
    </div>
  );
}

/** Marketing-page header. Pass `nav` to swap the right side per page. */
export function SiteHeader({ nav }: { nav?: React.ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
      <BrandLockup priority />
      <nav className="flex items-center gap-1 sm:gap-2">
        {nav ?? (
          <>
            <Link href="/pricing" className={navLinkClass}>
              Pricing
            </Link>
            <a
              href={GITHUB_REPO}
              className={navLinkClass}
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
            <Link href="/login" className={navPillClass}>
              Sign in
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-sand">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-stone sm:flex-row">
        <BrandLockup compact />
        <nav className="flex items-center gap-5">
          <Link href="/pricing" className="hover:text-ink">
            Pricing
          </Link>
          <Link href="/changelog" className="hover:text-ink">
            What&rsquo;s new
          </Link>
          <a
            href={GITHUB_REPO}
            className="hover:text-ink"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
          <Link href="/login" className="hover:text-ink">
            Sign in
          </Link>
        </nav>
        <span>Local-first. Your meetings never leave your device.</span>
      </div>
    </footer>
  );
}

export function DownloadButtons({ small = false }: { small?: boolean }) {
  const pad = small ? "px-4 py-2" : "px-5 py-2.5";
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <a
        href={DOWNLOADS.mac}
        className={`inline-flex items-center justify-center gap-2 rounded-lg bg-ink ${pad} text-sm font-medium text-cream transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep`}
      >
        <AppleLogo className="-mt-0.5 h-4 w-4" />
        Download for macOS
      </a>
      <a
        href={DOWNLOADS.win}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-sand bg-card ${pad} text-sm font-medium text-ink transition-colors hover:bg-sage-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep`}
      >
        <WindowsLogo className="h-3.5 w-3.5" />
        Windows (beta)
      </a>
    </div>
  );
}

/** Hand-drawn ink stroke under a headline's key word. */
export function DoodleStroke() {
  return (
    <svg
      className="doodle-stroke absolute -bottom-2 left-0 h-3 w-full text-sage"
      viewBox="0 0 300 12"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M4 8.5C42 4.5 96 3 150 5c46 1.7 92 2.5 146-1.5"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
