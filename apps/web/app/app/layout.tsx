import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { Wordmark } from "../ui";

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
      <header className="border-b border-sand">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/app" className="flex items-center gap-2.5">
            <Image
              src="/mascot.png"
              alt=""
              width={28}
              height={28}
              className="rounded-lg"
              unoptimized
            />
            <Wordmark size="text-base" />
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/app"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-bark transition-colors hover:bg-sage-fill hover:text-ink"
            >
              Meetings
            </Link>
            <Link
              href="/app/workspaces"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-bark transition-colors hover:bg-sage-fill hover:text-ink"
            >
              Workspaces
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        {children}
      </div>
    </div>
  );
}
