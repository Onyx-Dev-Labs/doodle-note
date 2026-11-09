"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import type { getHelpNavigation } from "../../content/help-guides";
import { COMMUNITY_URL } from "../../lib/community";
import { BrandLockup } from "../ui";
import { HelpSearch } from "./help-search";

type Navigation = ReturnType<typeof getHelpNavigation>;

function GuideNavigation({
  groups,
  close,
}: {
  groups: Navigation;
  close?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Help guides" className="help-guide-nav">
      <Link
        href="/help"
        className="help-nav-home"
        aria-current={pathname === "/help" ? "page" : undefined}
        onClick={close}
      >
        <span aria-hidden="true">⌂</span> Welcome to DoodleNote
      </Link>
      {groups.map((group) => (
        <div className="help-nav-group" key={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.guides.map((guide) => (
              <li key={guide.slug}>
                <Link
                  href={`/help/${guide.slug}`}
                  aria-current={
                    pathname === `/help/${guide.slug}` ? "page" : undefined
                  }
                  onClick={close}
                >
                  {guide.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="help-nav-bottom">
        <a
          href={COMMUNITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Join our community on Discord (opens in a new tab)"
          onClick={close}
        >
          Join our community <span aria-hidden="true">→</span>
        </a>
        <Link href="/app" prefetch={false} onClick={close}>
          Open workspace <span aria-hidden="true">→</span>
        </Link>
        <Link href="/changelog">
          What’s new <span aria-hidden="true">→</span>
        </Link>
        <Link href="/contact">
          Contact the team <span aria-hidden="true">→</span>
        </Link>
      </div>
    </nav>
  );
}

export function HelpShell({
  groups,
  children,
}: {
  groups: Navigation;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      document.getElementById("help-main")?.focus({ preventScroll: true });
      previousPath.current = pathname;
    }
  }, [pathname]);

  return (
    <div className="help-site">
      <a className="help-skip" href="#help-main">
        Skip to content
      </a>
      <header className="help-header">
        <div className="help-brand">
          <BrandLockup
            iconSize={34}
            compact
            wordmarkSize="text-xl"
            className="help-brand-lockup"
            textClassName="help-brand-copy"
          />
          <span className="help-brand-divider" />
          <Link href="/help" className="help-header-label">
            Help &amp; guides
          </Link>
        </div>
        <HelpSearch />
        <nav className="help-header-links" aria-label="Website">
          <Link href="/contact">Get in touch</Link>
          <Link href="/app" prefetch={false} className="help-button">
            Open workspace <span aria-hidden="true">→</span>
          </Link>
        </nav>
      </header>
      <div className="help-mobile-bar">
        <button
          onClick={() => menu.current?.showModal()}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">☰</span> Browse guides
        </button>
        <Link href="/help">Help &amp; guides</Link>
      </div>
      <div className="help-layout">
        <aside className="help-sidebar">
          <GuideNavigation groups={groups} />
        </aside>
        {children}
      </div>
      <dialog
        ref={menu}
        className="help-menu-dialog"
        aria-labelledby="help-menu-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) menu.current?.close();
        }}
      >
        <div className="help-menu-panel">
          <div className="help-menu-heading">
            <strong id="help-menu-title">Help &amp; guides</strong>
            <button
              className="help-close"
              aria-label="Close navigation"
              onClick={() => menu.current?.close()}
            >
              ✕
            </button>
          </div>
          <GuideNavigation
            groups={groups}
            close={() => menu.current?.close()}
          />
        </div>
      </dialog>
    </div>
  );
}
