import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { DOWNLOAD_LEAD_LINK_PATH, downloadLeadLinkState } from "@/lib/download-lead-link";

import { SiteFooter, SiteHeader } from "../../ui";
import { ConnectForm } from "./connect-form";

export const metadata: Metadata = {
  title: "Connect your download email — DoodleNote",
  // The token in the URL proves receipt of an email; never leak it onward.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const CARD =
  "rounded-xl border border-sand bg-card p-5 shadow-[0_12px_32px_-24px_rgba(38,40,31,0.35)] sm:p-7";

/**
 * Opened from a link in a DoodleNote email sent to a download address. The
 * visitor signs in to the account to connect, then confirms: the email link
 * proves the download address, the session proves the account.
 */
export default async function ConnectDownloadEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const requested = (await searchParams).token;
  const token = typeof requested === "string" ? requested : "";
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session && token) {
    const next = `${DOWNLOAD_LEAD_LINK_PATH}?${new URLSearchParams({ token })}`;
    redirect(`/login?${new URLSearchParams({ next })}`);
  }
  const state = session
    ? await downloadLeadLinkState(token, session.user.id)
    : ({ kind: "invalid" } as const);
  const accountEmail = session?.user.email ?? "";

  return (
    <div className="flex flex-1 flex-col bg-cream text-bark">
      <SiteHeader />
      <main className="flex flex-1 items-start px-6 pb-20 pt-12 sm:pt-20">
        <section className="mx-auto w-full max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sage-deep">
            Your DoodleNote emails
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Connect your download email.
          </h1>
          <div className={`mt-8 ${CARD}`}>
            {state.kind === "ready" ? (
              <>
                <p className="text-sm leading-relaxed text-bark">
                  Connect <strong className="font-semibold text-ink">{state.email}</strong>, the
                  address you downloaded DoodleNote with, to your account{" "}
                  <strong className="font-semibold text-ink">{accountEmail}</strong>?
                </p>
                <p className="mt-3 text-sm leading-relaxed text-stone">
                  The emails we send to {state.email} will then match your account. For example,
                  free-user tips stop once you have Cloud Sync.
                </p>
                <ConnectForm token={token} downloadEmail={state.email} />
                <p className="mt-4 text-xs leading-relaxed text-stone">
                  Not your account?{" "}
                  <Link
                    href={`/login?${new URLSearchParams({ next: `${DOWNLOAD_LEAD_LINK_PATH}?${new URLSearchParams({ token })}` })}`}
                    className="underline decoration-stone/50 underline-offset-2 hover:text-ink"
                  >
                    Sign in with a different account
                  </Link>
                  .
                </p>
              </>
            ) : state.kind === "linked" ? (
              <p className="text-sm leading-relaxed text-bark" role="status">
                {state.email} is connected to your account {accountEmail}.
              </p>
            ) : state.kind === "linked_to_other_account" ? (
              <p className="text-sm leading-relaxed text-bark" role="alert">
                {state.email} is already connected to another DoodleNote account.
              </p>
            ) : state.kind === "email_owned_by_other_account" ? (
              <p className="text-sm leading-relaxed text-bark" role="alert">
                {state.email} belongs to a different DoodleNote account. Sign in with that
                account instead; its emails already match it.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-bark" role="alert">
                This link is invalid or has expired. Use the link in your most recent
                DoodleNote email.
              </p>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
