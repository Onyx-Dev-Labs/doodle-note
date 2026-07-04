import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { googleEnabled } from "@/lib/create-auth";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Doodle Note" };

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/app");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <LoginForm googleEnabled={googleEnabled()} />
    </main>
  );
}
