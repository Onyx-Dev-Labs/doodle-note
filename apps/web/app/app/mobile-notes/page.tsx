import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAppWorkspace } from "@/lib/app-workspace";
import { WebMobileReader } from "./reader";
export default async function MobileNotes() {
  const workspace = await getAppWorkspace(await headers());
  if (!workspace) redirect("/login");
  return (
    <main>
      <Link href="/app">← All meetings</Link>
      <WebMobileReader organizationId={workspace.activeOrganization.id} />
    </main>
  );
}
