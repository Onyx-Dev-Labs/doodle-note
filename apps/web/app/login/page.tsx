import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { googleEnabled, microsoftEnabled } from "@/lib/create-auth";
import { safeNextPath } from "@/lib/safe-next-path";
import { resolveAuthEmailEnabled } from "@/lib/runtime-config";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — DoodleNote" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(nextPath);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-cream px-6 py-16 text-bark">
      <LoginForm
        googleEnabled={googleEnabled()}
        microsoftEnabled={microsoftEnabled()}
        emailVerificationEnabled={resolveAuthEmailEnabled()}
        next={nextPath}
      />
    </main>
  );
}
