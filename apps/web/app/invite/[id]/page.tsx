import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { AcceptInvite } from "./accept-invite";

export const metadata = { title: "Workspace invitation — DoodleNote" };

/** Invitation landing page: sign in (with the invited email), then accept. */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    redirect(`/login?${new URLSearchParams({ next: `/invite/${id}` })}`);
  }

  let organizationName: string | null = null;
  let inviterEmail: string | null = null;
  let problem: string | null = null;
  try {
    const invitation = await auth.api.getInvitation({
      headers: requestHeaders,
      query: { id },
    });
    organizationName = invitation.organizationName;
    inviterEmail = invitation.inviterEmail;
  } catch {
    problem =
      "This invitation doesn't exist, has expired, or was sent to a different email address. Make sure you're signed in with the address that was invited.";
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-cream px-6 py-16 text-bark">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-sand bg-card p-6 text-center shadow-[0_1px_0_var(--color-sand),0_12px_32px_-20px_rgba(38,40,31,0.35)]">
        <Image
          src="/mascot.png"
          alt=""
          width={40}
          height={40}
          className="rounded-lg"
          unoptimized
        />
        {problem ? (
          <>
            <h1 className="mt-4 font-display text-lg font-semibold text-ink">
              Invitation not available
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bark">{problem}</p>
            <p className="mt-2 text-xs text-stone">
              Signed in as {session!.user.email}
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-display text-lg font-semibold text-ink">
              Join “{organizationName}”?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bark">
              {inviterEmail} invited you to their DoodleNote workspace. You’ll
              see the meetings and notes synced to it.
            </p>
            <AcceptInvite invitationId={id} />
          </>
        )}
      </div>
    </main>
  );
}
