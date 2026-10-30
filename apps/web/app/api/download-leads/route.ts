import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { isDownloadPlatform, type DownloadPlatform } from "@/lib/download-consent";
import { createDownloadGrant, downloadGrantCookie } from "@/lib/download-grant";
import {
  normalizeLeadEmail,
  recordDownloadRequest,
  type DownloadRequest,
  type RecordedDownloadRequest,
} from "@/lib/download-leads";

const MAX_BODY_BYTES = 4_096;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT_MAX = 10;

interface DownloadLeadHandlerDependencies {
  now?: () => number;
  allowRequest?: (request: Request, now: number) => boolean;
  record?: (request: DownloadRequest) => Promise<RecordedDownloadRequest>;
  grant?: (now: number) => string;
}

type RateLimitEntry = { count: number; windowStartedAt: number };

const rateLimitState = globalThis as typeof globalThis & {
  __doodleNoteDownloadRateLimits?: Map<string, RateLimitEntry>;
};
const rateLimits =
  rateLimitState.__doodleNoteDownloadRateLimits ??
  (rateLimitState.__doodleNoteDownloadRateLimits = new Map());

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

function allowRequest(request: Request, now: number): boolean {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  if (!address) return true;
  const key = createHash("sha256").update(address).digest("hex");

  if (rateLimits.size > 1_000) {
    for (const [candidate, entry] of rateLimits) {
      if (now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(candidate);
    }
  }
  const existing = rateLimits.get(key);
  if (!existing || now - existing.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { count: 1, windowStartedAt: now });
    return true;
  }
  if (existing.count >= RATE_LIMIT_MAX) return false;
  existing.count += 1;
  return true;
}

function parseSubmission(
  value: unknown,
):
  | { kind: "valid"; email: string; platform: DownloadPlatform }
  | { kind: "honeypot"; platform: DownloadPlatform }
  | { kind: "invalid"; field: "email" | "platform" | "consent" } {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (!isDownloadPlatform(input.platform)) return { kind: "invalid", field: "platform" };
  if (typeof input.website === "string" && input.website.trim()) {
    return { kind: "honeypot", platform: input.platform };
  }
  const email = normalizeLeadEmail(input.email);
  if (!email) return { kind: "invalid", field: "email" };
  // The download is offered in exchange for DoodleNote emails, so the form
  // requires the box; refuse requests that skip it.
  if (input.marketingConsent !== true) return { kind: "invalid", field: "consent" };
  return { kind: "valid", email, platform: input.platform };
}

const INVALID_FIELD_MESSAGES = {
  email: "Enter a valid email address.",
  platform: "Choose macOS or Windows.",
  consent: "Tick the box to agree to DoodleNote emails before downloading.",
} as const;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

/**
 * Stores a website download request, then releases the installer. The lead
 * and its MailCheap sync event are committed before the grant is issued; an
 * n8n or MailCheap outage later only delays the sync, never the download.
 */
export function createDownloadLeadPostHandler(
  dependencies: DownloadLeadHandlerDependencies = {},
) {
  const now = dependencies.now ?? Date.now;
  const isAllowed = dependencies.allowRequest ?? allowRequest;
  const record = dependencies.record ?? ((request) => recordDownloadRequest(request));
  const grant = dependencies.grant ?? ((at) => createDownloadGrant(at));

  return async function POST(request: Request): Promise<Response> {
    if (!sameOrigin(request)) {
      return json({ error: "This request could not be accepted." }, 403);
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return json({ error: "This request could not be accepted." }, 415);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ error: "This request could not be accepted." }, 413);
    }

    let input: unknown;
    try {
      input = JSON.parse(rawBody);
    } catch {
      return json({ error: "Please check the form and try again." }, 400);
    }

    const parsed = parseSubmission(input);
    if (parsed.kind === "invalid") {
      return json({ error: INVALID_FIELD_MESSAGES[parsed.field] }, 400);
    }
    // Bots that fill the hidden field get an answer that looks normal but no grant.
    if (parsed.kind === "honeypot") {
      return json({ ok: true, downloadUrl: `/download/${parsed.platform}` });
    }

    const currentTime = now();
    if (!isAllowed(request, currentTime)) {
      return json({ error: "Too many requests. Please try again in a few minutes." }, 429);
    }

    try {
      await record({
        email: parsed.email,
        platform: parsed.platform,
        marketingConsent: true,
        now: new Date(currentTime),
      });
    } catch (error) {
      console.error("[download-leads] Could not store a download request.", {
        error: error instanceof Error ? error.name : "unknown",
      });
      return json(
        { error: "We couldn't start your download right now. Please try again." },
        503,
      );
    }

    const secure = new URL(request.url).protocol === "https:";
    return json(
      { ok: true, downloadUrl: `/download/${parsed.platform}` },
      200,
      { "set-cookie": downloadGrantCookie(grant(currentTime), secure) },
    );
  };
}

export const POST = createDownloadLeadPostHandler();
