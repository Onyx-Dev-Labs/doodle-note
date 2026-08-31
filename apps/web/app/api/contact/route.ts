import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

const CONTACT_RECIPIENT = "team@onyxdev.io";
const MAX_BODY_BYTES = 16_384;
const MIN_COMPLETION_MS = 2_000;
const MAX_COMPLETION_MS = 2 * 60 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT_MAX = 5;

export interface ContactSubmission {
  name: string;
  email: string;
  company: string;
  phone: string;
  message: string;
}

interface ContactEmail {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
  html: string;
}

interface ContactHandlerDependencies {
  now?: () => number;
  allowRequest?: (request: Request, now: number) => boolean;
  sendEmail?: (
    submission: ContactSubmission,
    idempotencyKey: string,
  ) => Promise<void>;
}

type RateLimitEntry = { count: number; windowStartedAt: number };

const rateLimitState = globalThis as typeof globalThis & {
  __doodleNoteContactRateLimits?: Map<string, RateLimitEntry>;
};
const rateLimits =
  rateLimitState.__doodleNoteContactRateLimits ??
  (rateLimitState.__doodleNoteContactRateLimits = new Map());

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function oneLine(value: unknown): string | null {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
}

function parseSubmission(
  value: unknown,
  now: number,
):
  | { kind: "valid"; submission: ContactSubmission; startedAt: number }
  | { kind: "honeypot" }
  | { kind: "invalid" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "invalid" };
  }

  const input = value as Record<string, unknown>;
  const website = oneLine(input.website);
  if (website) return { kind: "honeypot" };

  const name = oneLine(input.name);
  const email = oneLine(input.email)?.toLowerCase() ?? null;
  const company = oneLine(input.company);
  const phone = oneLine(input.phone);
  const message = typeof input.message === "string" ? input.message.trim() : null;
  const startedAt = input.startedAt;
  const elapsed = typeof startedAt === "number" ? now - startedAt : NaN;

  if (
    !name ||
    name.length < 2 ||
    name.length > 100 ||
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    company === null ||
    company.length > 120 ||
    phone === null ||
    phone.length > 40 ||
    !message ||
    message.length < 10 ||
    message.length > 5_000 ||
    !Number.isFinite(elapsed) ||
    elapsed < MIN_COMPLETION_MS ||
    elapsed > MAX_COMPLETION_MS
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "valid",
    startedAt: startedAt as number,
    submission: { name, email, company, phone, message },
  };
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    origin === new URL(request.url).origin &&
    (!fetchSite || fetchSite === "same-origin")
  );
}

function rateLimitKey(request: Request): string | null {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  return address
    ? createHash("sha256").update(address).digest("hex")
    : null;
}

function allowRequest(request: Request, now: number): boolean {
  const key = rateLimitKey(request);
  if (!key) return true;

  if (rateLimits.size > 1_000) {
    for (const [candidate, entry] of rateLimits) {
      if (now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
        rateLimits.delete(candidate);
      }
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

export function buildContactEmail(
  submission: ContactSubmission,
  from: string,
): ContactEmail {
  const company = submission.company || "Not provided";
  const phone = submission.phone || "Not provided";
  return {
    from,
    to: [CONTACT_RECIPIENT],
    reply_to: submission.email,
    subject: `DoodleNote contact from ${submission.name}`,
    text: [
      "New DoodleNote contact form submission",
      "",
      `Name: ${submission.name}`,
      `Email: ${submission.email}`,
      `Company: ${company}`,
      `Phone: ${phone}`,
      "",
      "Message:",
      submission.message,
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f7f5ee;color:#26281f;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e7e3d8;border-radius:12px;overflow:hidden;">
      <div style="padding:20px 24px;background:#e9efe0;border-bottom:1px solid #e7e3d8;">
        <strong style="font-size:20px;">New DoodleNote message</strong>
      </div>
      <div style="padding:24px;line-height:1.6;">
        <p style="margin:0 0 6px;"><strong>Name:</strong> ${html(submission.name)}</p>
        <p style="margin:0 0 6px;"><strong>Email:</strong> ${html(submission.email)}</p>
        <p style="margin:0 0 6px;"><strong>Company:</strong> ${html(company)}</p>
        <p style="margin:0 0 20px;"><strong>Phone:</strong> ${html(phone)}</p>
        <p style="margin:0 0 8px;"><strong>Message</strong></p>
        <div style="white-space:pre-wrap;padding:16px;background:#fdfcf8;border:1px solid #e7e3d8;border-radius:8px;">${html(submission.message)}</div>
      </div>
    </div>
  </body>
</html>`,
  };
}

async function sendContactEmail(
  submission: ContactSubmission,
  idempotencyKey: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CONTACT_FROM_EMAIL || process.env.AUTH_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Contact email delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(buildContactEmail(submission, from)),
  });
  if (!response.ok) {
    console.error("[contact] Resend rejected a contact email.", {
      status: response.status,
    });
    throw new Error("Contact email delivery failed.");
  }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function createContactPostHandler(
  dependencies: ContactHandlerDependencies = {},
) {
  const now = dependencies.now ?? Date.now;
  const isAllowed = dependencies.allowRequest ?? allowRequest;
  const deliver = dependencies.sendEmail ?? sendContactEmail;

  return async function POST(request: Request): Promise<Response> {
    if (!sameOrigin(request)) {
      return json({ error: "This request could not be accepted." }, 403);
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return json({ error: "This request could not be accepted." }, 415);
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return json({ error: "Your message is too large." }, 413);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Your message is too large." }, 413);
    }

    let input: unknown;
    try {
      input = JSON.parse(rawBody);
    } catch {
      return json({ error: "Please check the form and try again." }, 400);
    }

    const currentTime = now();
    const parsed = parseSubmission(input, currentTime);
    if (parsed.kind === "honeypot") return json({ ok: true });
    if (parsed.kind === "invalid") {
      return json({ error: "Please check the form and try again." }, 400);
    }
    if (!isAllowed(request, currentTime)) {
      return json(
        { error: "Too many messages were sent. Please try again later." },
        429,
      );
    }

    const idempotencyKey = `doodlenote-contact-${createHash("sha256")
      .update(JSON.stringify([parsed.submission, parsed.startedAt]))
      .digest("hex")}`;
    try {
      await deliver(parsed.submission, idempotencyKey);
    } catch {
      return json(
        { error: "Your message could not be sent right now. Please try again." },
        502,
      );
    }
    return json({ ok: true });
  };
}

export const POST = createContactPostHandler();
