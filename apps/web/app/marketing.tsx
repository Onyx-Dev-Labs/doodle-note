import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppleLogo, GitHubLogo, WindowsLogo } from "./logos";
import { DOWNLOADS, GITHUB_REPO, ONYX_URL } from "./ui";

const APP_DEMO = "https://doodlenote-design-preview.vercel.app/app.html";

function MarketingBrand() {
  return (
    <div className="brand-lockup">
      <Link className="brand-symbol" href="/" aria-label="DoodleNote home">
        <Image src="/mascot.png" alt="" width={43} height={43} unoptimized />
      </Link>
      <div className="brand-text">
        <Link className="brand" href="/">
          DoodleNote<span className="brand-period">.</span>
        </Link>
        <p className="builder-credit">
          Built by{" "}
          <a href={ONYX_URL} target="_blank" rel="noopener noreferrer">
            Onyx Dev Labs
          </a>
        </p>
      </div>
    </div>
  );
}

function GitHubLink() {
  return (
    <a
      className="github-link"
      href={GITHUB_REPO}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="DoodleNote on GitHub"
    >
      <GitHubLogo className="platform-icon" />
    </a>
  );
}

export function MarketingHeader() {
  return (
    <header className="site-header wrap">
      <MarketingBrand />
      <nav className="desktop-nav" aria-label="Main navigation">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/pricing">Pricing</Link>
        <a href={APP_DEMO}>App demo</a>
      </nav>
      <div className="header-actions">
        <GitHubLink />
        <Link className="button button-small button-outline" href="/login">
          Sign in
        </Link>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="wrap footer">
      <MarketingBrand />
      <nav className="footer-nav" aria-label="Footer">
        <Link href="/pricing">Pricing</Link>
        <Link href="/changelog">What’s new</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/login">Sign in</Link>
        <GitHubLink />
      </nav>
      <span>Local-first. Cloud only when you opt in.</span>
    </footer>
  );
}

/** Every marketing download uses Sean's shared email-gated entry points. */
export function MarketingDownloadButtons({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`download-actions ${className}`}>
      <a className="button download-mac" href={DOWNLOADS.mac}>
        <AppleLogo className="platform-icon" />
        <span>Download for macOS</span>
      </a>
      <a className="button download-win" href={DOWNLOADS.win}>
        <WindowsLogo className="platform-icon" />
        <span>
          Windows <small className="beta-label">beta</small>
        </span>
      </a>
    </div>
  );
}

export function MarketingLayout({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`marketing ${className}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}
