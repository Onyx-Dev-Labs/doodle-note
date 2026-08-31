"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/app/settings/sync", "Sync & devices"],
  ["/app/settings/billing", "Billing"],
  ["/app/settings/workspace", "Workspace"],
  ["/app/settings/members", "Members"],
  ["/app/settings/invitations", "Invitations"],
  ["/app/settings/agents", "Agent access"],
  ["/app/settings/security", "Account & security"],
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex w-full max-w-full flex-wrap gap-1 lg:block lg:space-y-1">
      {items.map(([href, label]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`block shrink-0 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sage-deep ${
              active
                ? "bg-sage-fill font-medium text-ink"
                : "text-bark hover:bg-card hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
