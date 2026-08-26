"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandLockup } from "../ui";
import { SignOutButton } from "./sign-out-button";

const navItems = [
  { href: "/app", label: "Meetings", exact: true },
  { href: "/app/shared", label: "Shared" },
  { href: "/app/settings/sync", label: "Settings" },
];

export function AppHeader({
  email,
  activeWorkspaceName,
}: {
  email: string;
  activeWorkspaceName: string;
}) {
  const pathname = usePathname();
  const initial = email.slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-sand bg-cream/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-3 sm:gap-4 sm:px-6">
        <BrandLockup
          href="/app"
          compact
          iconSize={28}
          wordmarkSize="text-base"
          textClassName="hidden min-[480px]:flex"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sage-deep"
        />

        <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
          {navItems.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep sm:px-3 ${
                  active
                    ? "bg-sage-fill text-ink"
                    : "text-bark hover:bg-card hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <details className="group relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-sand bg-card px-2 py-1.5 text-left transition-colors hover:bg-sage-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-xs font-semibold text-cream">
              {initial}
            </span>
            <span className="hidden max-w-36 sm:block">
              <span className="block truncate text-xs font-medium text-ink">
                {activeWorkspaceName}
              </span>
              <span className="block truncate text-[11px] text-stone">
                {email}
              </span>
            </span>
            <span aria-hidden="true" className="text-xs text-stone">
              ▾
            </span>
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-sand bg-card p-2 shadow-xl shadow-ink/10">
            <div className="border-b border-sand px-2 pb-2">
              <p className="truncate text-sm font-medium text-ink">{email}</p>
              <p className="truncate text-xs text-stone">{activeWorkspaceName}</p>
            </div>
            <Link
              href="/app/settings/sync"
              className="mt-1 block rounded-md px-2 py-2 text-sm text-bark hover:bg-sage-fill hover:text-ink"
            >
              Sync &amp; devices
            </Link>
            <Link
              href="/app/settings/workspace"
              className="block rounded-md px-2 py-2 text-sm text-bark hover:bg-sage-fill hover:text-ink"
            >
              Workspace settings
            </Link>
            <Link
              href="/app/settings/security"
              className="block rounded-md px-2 py-2 text-sm text-bark hover:bg-sage-fill hover:text-ink"
            >
              Account &amp; security
            </Link>
            <div className="mt-1 border-t border-sand pt-2">
              <SignOutButton compact />
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
