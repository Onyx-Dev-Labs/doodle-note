import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <header className="border-b border-sand bg-card-soft">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-3">
          <Link href="/app" className="flex items-center gap-2">
            <Image
              src="/mascot.png"
              alt=""
              width={26}
              height={26}
              className="rounded-md"
            />
            <span className="text-sm font-bold tracking-tight">
              <span className="text-ink">Doodle</span>
              <span className="text-sage">Note</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/app" className="text-bark hover:text-ink">
              Meetings
            </Link>
            <Link href="/app/workspaces" className="text-bark hover:text-ink">
              Workspaces
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        {children}
      </div>
    </div>
  );
}
