import { createHmac, timingSafeEqual } from "node:crypto";

import { getDb, sql, type Db } from "@repo/db";

import { resolveAuthSecret } from "./runtime-config";

/**
 * Linking a download lead to a DoodleNote account needs proof of both
 * identities from one person:
 *
 * - the download address: a signed link that n8n puts only in emails sent to
 *   that address, and
 * - the account: a signed-in session when the link is confirmed.
 *
 * A session alone never links an address, and a link alone never picks the
 * account. The link records identity only; n8n reclassifies from Stripe.
 */
export const DOWNLOAD_LEAD_LINK_TTL_SECONDS = 180 * 24 * 60 * 60;
export const DOWNLOAD_LEAD_LINK_PATH = "/download/connect";
const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("doodlenote-download-lead-link-v1").digest();
}

function sign(payload: string, email: string, secret: string): string {
  // The address is signed but not carried, so the token never exposes it.
  return createHmac("sha256", signingKey(secret)).update(`${payload}|${email}`).digest("base64url");
}

/** A token proving its holder received mail at the lead's address. */
export function createDownloadLeadLinkToken(
  lead: { leadId: string; email: string },
  nowMs = Date.now(),
  secret = resolveAuthSecret(),
): string {
  const expires = Math.floor(nowMs / 1000) + DOWNLOAD_LEAD_LINK_TTL_SECONDS;
  const payload = `${VERSION}.${lead.leadId}.${expires}`;
  return `${payload}.${sign(payload, lead.email, secret)}`;
}

export function downloadLeadLinkUrl(
  baseUrl: string,
  lead: { leadId: string; email: string },
  nowMs = Date.now(),
  secret = resolveAuthSecret(),
): string {
  const url = new URL(DOWNLOAD_LEAD_LINK_PATH, baseUrl);
  url.searchParams.set("token", createDownloadLeadLinkToken(lead, nowMs, secret));
  return url.toString();
}

/** The lead ID a token names, before its signature is checked against the address. */
export function readDownloadLeadLinkToken(
  token: unknown,
  nowMs = Date.now(),
): { leadId: string; payload: string; signature: string } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [version, leadId, expires, signature] = parts;
  const expiresAt = Number(expires);
  if (!UUID.test(leadId) || !Number.isInteger(expiresAt) || expiresAt * 1000 <= nowMs) return null;
  return { leadId: leadId.toLowerCase(), payload: `${version}.${leadId}.${expires}`, signature };
}

export function verifyDownloadLeadLinkToken(
  token: unknown,
  email: string,
  nowMs = Date.now(),
  secret = resolveAuthSecret(),
): string | null {
  const parsed = readDownloadLeadLinkToken(token, nowMs);
  if (!parsed) return null;
  const supplied = Buffer.from(parsed.signature);
  const expected = Buffer.from(sign(parsed.payload, email, secret));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? parsed.leadId
    : null;
}

export type DownloadLeadLinkState =
  | { kind: "invalid" }
  | { kind: "ready"; leadId: string; email: string }
  | { kind: "linked"; leadId: string; email: string }
  | { kind: "linked_to_other_account"; email: string }
  | { kind: "email_owned_by_other_account"; email: string };

type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  return Array.isArray(result) ? result : ((result as { rows?: Row[] }).rows ?? []);
}

/**
 * What confirming this token would do for the signed-in user, without writing.
 * The download address must not belong to a different account: that account's
 * owner signs in with it instead.
 */
export async function downloadLeadLinkState(
  token: unknown,
  userId: string,
  options: { now?: Date; secret?: string } = {},
  db: Db = getDb(),
): Promise<DownloadLeadLinkState> {
  const nowMs = (options.now ?? new Date()).getTime();
  const parsed = readDownloadLeadLinkToken(token, nowMs);
  if (!parsed) return { kind: "invalid" };
  const [lead] = rows(
    await db.execute(sql`
      select l.id, l.email,
        (select k.user_id from download_lead_links k where k.lead_id = l.id) as linked_user_id,
        exists (
          select 1 from "user" u where lower(u.email) = l.email and u.id <> ${userId}
        ) as owned_by_other
      from download_leads l
      where l.id = ${parsed.leadId}::uuid
    `),
  );
  if (!lead) return { kind: "invalid" };
  const email = String(lead.email);
  if (!verifyDownloadLeadLinkToken(token, email, nowMs, options.secret)) return { kind: "invalid" };
  const leadId = String(lead.id);
  if (lead.linked_user_id === userId) return { kind: "linked", leadId, email };
  if (lead.linked_user_id) return { kind: "linked_to_other_account", email };
  if (lead.owned_by_other === true) return { kind: "email_owned_by_other_account", email };
  return { kind: "ready", leadId, email };
}

export type DownloadLeadLinkResult =
  | { kind: "invalid" }
  | { kind: "linked"; leadId: string; email: string; created: boolean }
  | { kind: "linked_to_other_account"; email: string }
  | { kind: "email_owned_by_other_account"; email: string };

/**
 * Records the link and queues one download_lead_linked event in a single
 * statement, so n8n hears about every link exactly once. Confirming again is
 * a no-op; a lead already linked to another account stays with it.
 */
export async function linkDownloadLead(
  input: { token: unknown; userId: string; now?: Date; secret?: string },
  db: Db = getDb(),
): Promise<DownloadLeadLinkResult> {
  const now = input.now ?? new Date();
  const state = await downloadLeadLinkState(input.token, input.userId, { now, secret: input.secret }, db);
  if (state.kind !== "ready") {
    return state.kind === "linked" ? { ...state, created: false } : state;
  }
  const nowIso = now.toISOString();
  const [result] = rows(
    await db.execute(sql`
      with eligible as (
        select l.id from download_leads l
        where l.id = ${state.leadId}::uuid
          and not exists (
            select 1 from "user" u where lower(u.email) = l.email and u.id <> ${input.userId}
          )
      ), link as (
        insert into download_lead_links (lead_id, user_id, method, verified_at, created_at)
        select id, ${input.userId}, 'email_confirmation', ${nowIso}::timestamptz, ${nowIso}::timestamptz
        from eligible
        on conflict (lead_id) do nothing
        returning lead_id, user_id
      ), event as (
        insert into download_lead_events (
          dedupe_key, lead_id, event_type, sync_status, next_attempt_at, created_at, updated_at
        )
        select 'download_lead_linked:' || lead_id || ':' || user_id, lead_id, 'download_lead_linked',
          'pending', ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${nowIso}::timestamptz
        from link
        on conflict (dedupe_key) do nothing
        returning id
      )
      select (select count(*) from link)::int as created
    `),
  );
  if (Number(result?.created) === 1) {
    return { kind: "linked", leadId: state.leadId, email: state.email, created: true };
  }
  // Lost a race with another confirmation or account: report what stands now.
  const after = await downloadLeadLinkState(input.token, input.userId, { now, secret: input.secret }, db);
  if (after.kind === "linked") return { ...after, created: false };
  if (after.kind === "ready") return { kind: "invalid" };
  return after;
}
