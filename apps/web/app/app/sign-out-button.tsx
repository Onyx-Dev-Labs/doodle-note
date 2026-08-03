"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
      className={
        compact
          ? "w-full rounded-md px-2 py-2 text-left text-sm text-bark transition-colors hover:bg-sage-fill hover:text-ink"
          : "rounded-md border border-sand bg-card px-3.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sage-fill"
      }
    >
      Sign out
    </button>
  );
}
