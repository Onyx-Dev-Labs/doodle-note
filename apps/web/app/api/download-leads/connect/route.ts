import { NextResponse } from "next/server";

import { linkDownloadLead, type DownloadLeadLinkResult } from "@/lib/download-lead-link";

const MAX_BODY_BYTES = 1024;

export interface ConnectHandlerDependencies {
  /** The signed-in user, or null. */
  currentUserId?: (request: Request) => Promise<string | null>;
  link?: (input: { token: unknown; userId: string }) => Promise<DownloadLeadLinkResult>;
}

async function sessionUserId(): Promise<string | null> {
  // Loaded on first use: the auth module is server-only, and tests inject the user.
  const [{ auth }, { headers }] = await Promise.all([import("@/lib/auth"), import("next/headers")]);
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function sameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

/**
 * Confirms a download-address link for the signed-in account. Both proofs are
 * required: the signed token from an email sent to the download address, and
 * the session. Linking records identity only; n8n reclassifies from Stripe.
 */
export function createConnectPostHandler(dependencies: ConnectHandlerDependencies = {}) {
  const currentUserId = dependencies.currentUserId ?? sessionUserId;
  const link = dependencies.link ?? ((input) => linkDownloadLead(input));

  return async function POST(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "This request could not be accepted." }, 403);
    const userId = await currentUserId(request);
    if (!userId) return json({ error: "Sign in to connect this email." }, 401);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: "This request could not be accepted." }, 413);
    }
    let token: unknown;
    try {
      token = (JSON.parse(raw) as { token?: unknown } | null)?.token;
    } catch {
      return json({ error: "This request could not be accepted." }, 400);
    }

    const result = await link({ token, userId });
    switch (result.kind) {
      case "linked":
        return json({ ok: true, email: result.email, created: result.created });
      case "linked_to_other_account":
        return json({ error: "This email is already connected to another DoodleNote account." }, 409);
      case "email_owned_by_other_account":
        return json(
          { error: "This email belongs to a different DoodleNote account. Sign in with that account instead." },
          409,
        );
      default:
        return json({ error: "This link is invalid or has expired." }, 400);
    }
  };
}

export const POST = createConnectPostHandler();
