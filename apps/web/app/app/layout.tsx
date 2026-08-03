import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppWorkspace } from "@/lib/app-workspace";

import { AppHeader } from "./app-header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");

  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <AppHeader
        email={workspace.session.user.email}
        activeWorkspaceName={workspace.activeOrganization.name}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </div>
    </div>
  );
}
