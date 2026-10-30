import { timingSafeEqual } from "node:crypto";

import { getDb, sql, type Db } from "@repo/db";

import {
  MARKETING_CONSENT_TEXT,
  MARKETING_CONSENT_VERSION,
  type DownloadPlatform,
} from "./download-consent";
import { downloadLeadLinkUrl } from "./download-lead-link";

export const DOWNLOAD_LEAD_SOURCE = "website_download";
export const DOWNLOAD_EVENT_TYPE = "free_download_requested";

/** A worker that stops answering loses its claim after this; the event is claimed again. */
export const CLAIM_LEASE_MS = 10 * 60 * 1_000;
export const MAX_CLAIM_LIMIT = 50;
/** Where account-link URLs point when the caller does not pass its own origin. */
export const DEFAULT_SITE_URL = "https://www.doodlenote.ai";
const FIRST_RETRY_MS = 5 * 60 * 1_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1_000;
const MAX_ERROR_LENGTH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Row = Record<string, unknown>;

function rows(result: unknown): Row[] {
  return Array.isArray(result) ? result : ((result as { rows?: Row[] }).rows ?? []);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Trimmed and lowercased, or null when it isn't a plausible address. */
export function normalizeLeadEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export interface DownloadRequest {
  email: string;
  platform: DownloadPlatform;
  marketingConsent: boolean;
  now?: Date;
}

export interface RecordedDownloadRequest {
  leadId: string;
  newLead: boolean;
  marketingConsent: boolean;
  /** Null when the same request was already recorded today. */
  eventId: string | null;
}

/**
 * Upserts the lead and writes its sync event in one statement, so both commit
 * or neither does (the Neon HTTP driver has no interactive transactions).
 * Permission, once granted, keeps its first timestamp, wording and version.
 */
export async function recordDownloadRequest(
  request: DownloadRequest,
  db: Db = getDb(),
): Promise<RecordedDownloadRequest> {
  const now = (request.now ?? new Date()).toISOString();
  const day = now.slice(0, 10);
  const consent = request.marketingConsent;
  const result = await db.execute(sql`
    with lead as (
      insert into download_leads (
        email, source, first_platform, latest_platform, first_requested_at,
        latest_requested_at, marketing_consent, marketing_consent_at,
        marketing_consent_version, marketing_consent_text, created_at, updated_at
      ) values (
        ${request.email}, ${DOWNLOAD_LEAD_SOURCE}, ${request.platform}, ${request.platform},
        ${now}::timestamptz, ${now}::timestamptz, ${consent},
        ${consent ? now : null}::timestamptz,
        ${consent ? MARKETING_CONSENT_VERSION : null},
        ${consent ? MARKETING_CONSENT_TEXT : null},
        ${now}::timestamptz, ${now}::timestamptz
      )
      on conflict (email) do update set
        latest_platform = excluded.latest_platform,
        latest_requested_at = greatest(download_leads.latest_requested_at, excluded.latest_requested_at),
        request_count = download_leads.request_count + 1,
        marketing_consent = download_leads.marketing_consent or excluded.marketing_consent,
        marketing_consent_at = coalesce(download_leads.marketing_consent_at, excluded.marketing_consent_at),
        marketing_consent_version = coalesce(download_leads.marketing_consent_version, excluded.marketing_consent_version),
        marketing_consent_text = coalesce(download_leads.marketing_consent_text, excluded.marketing_consent_text),
        updated_at = excluded.updated_at
      returning id, marketing_consent, (xmax = 0) as inserted
    ), event as (
      insert into download_lead_events (
        dedupe_key, lead_id, event_type, platform, requested_at,
        sync_status, sync_outcome, next_attempt_at, created_at, updated_at
      )
      select
        ${DOWNLOAD_EVENT_TYPE} || ':' || lead.id || ':' || ${request.platform} || ':' || ${day}
          || ':' || case when lead.marketing_consent then 'consented' else 'no-consent' end,
        lead.id, ${DOWNLOAD_EVENT_TYPE}, ${request.platform}, ${now}::timestamptz,
        case when lead.marketing_consent then 'pending' else 'skipped' end,
        case when lead.marketing_consent then null else 'no_marketing_permission' end,
        ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
      from lead
      on conflict (dedupe_key) do nothing
      returning id
    )
    select lead.id as lead_id, lead.inserted, lead.marketing_consent, event.id as event_id
    from lead left join event on true
  `);
  const row = rows(result)[0];
  if (!row) throw new Error("Download request was not recorded");
  return {
    leadId: String(row.lead_id),
    newLead: row.inserted === true,
    marketingConsent: row.marketing_consent === true,
    eventId: row.event_id ? String(row.event_id) : null,
  };
}

export const DOWNLOAD_LINKED_EVENT_TYPE = "download_lead_linked";
export const DOWNLOAD_EVENT_TYPES = [DOWNLOAD_EVENT_TYPE, DOWNLOAD_LINKED_EVENT_TYPE] as const;
export type DownloadEventType = (typeof DOWNLOAD_EVENT_TYPES)[number];

export function isDownloadEventType(value: unknown): value is DownloadEventType {
  return typeof value === "string" && (DOWNLOAD_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The DoodleNote account registered with this exact normalized email, if any.
 * The account lifecycle (trial_active, paying_customer) owns such contacts.
 * userId is the real app user ID; stripeCustomerId is set once the account
 * has started checkout. Both are null for a download-only lead.
 */
export interface DownloadLeadAccount {
  exists: boolean;
  userId: string | null;
  stripeCustomerId: string | null;
  cloudSyncStatus: string | null;
}

/** A verified link from the lead to an account with a different or the same address. */
export interface DownloadLeadLink {
  userId: string;
  accountEmail: string;
  stripeCustomerId: string | null;
  cloudSyncStatus: string;
  method: "email_confirmation";
  verifiedAt: string;
}

interface ClaimedEventBase {
  eventId: string;
  claimToken: string;
  attempt: number;
  leadId: string;
  email: string;
  source: string;
  firstRequestedAt: string;
  latestRequestedAt: string;
  requestCount: number;
  marketingConsent: {
    granted: boolean;
    grantedAt: string | null;
    version: string | null;
  };
  account: DownloadLeadAccount;
}

export interface ClaimedDownloadRequestEvent extends ClaimedEventBase {
  eventType: typeof DOWNLOAD_EVENT_TYPE;
  platform: DownloadPlatform;
  requestedAt: string;
  /** True only for a download-only lead: no account, trial, or subscription under this address. */
  freeDownloadLifecycleEligible: boolean;
  /**
   * Signed link that lets this address's owner connect it to their account.
   * Put it only in email sent to this address; it proves receipt of that mail.
   */
  accountLinkUrl: string;
}

export interface ClaimedDownloadLinkedEvent extends ClaimedEventBase {
  eventType: typeof DOWNLOAD_LINKED_EVENT_TYPE;
  /** Identity only: reclassify from Stripe before changing any lifecycle. */
  link: DownloadLeadLink;
}

export type ClaimedDownloadEvent = ClaimedDownloadRequestEvent | ClaimedDownloadLinkedEvent;

function account(row: Row): DownloadLeadAccount {
  const exists = row.user_id !== null && row.user_id !== undefined;
  return {
    exists,
    userId: exists ? String(row.user_id) : null,
    stripeCustomerId: exists && row.stripe_customer_id ? String(row.stripe_customer_id) : null,
    cloudSyncStatus: exists ? String(row.cloud_sync_status) : null,
  };
}

function link(row: Row): DownloadLeadLink | null {
  if (!row.link_user_id) return null;
  return {
    userId: String(row.link_user_id),
    accountEmail: String(row.link_account_email),
    stripeCustomerId: row.link_stripe_customer_id ? String(row.link_stripe_customer_id) : null,
    cloudSyncStatus: String(row.link_cloud_sync_status),
    method: "email_confirmation",
    verifiedAt: iso(row.link_verified_at)!,
  };
}

/** The same-address account and the verified link, joined onto a row with the lead as `l`. */
const accountJoins = sql`
    left join lateral (
      select u.id as user_id, s.stripe_customer_id,
        case when s.grandfathered then 'grandfathered' else coalesce(s.status, 'none') end as cloud_sync_status
      from "user" u
      left join subscriptions s on s.user_id = u.id
      where lower(u.email) = l.email
      order by u.created_at
      limit 1
    ) a on true
    left join lateral (
      select k.user_id as link_user_id, k.verified_at as link_verified_at, u.email as link_account_email,
        s.stripe_customer_id as link_stripe_customer_id,
        case when s.grandfathered then 'grandfathered' else coalesce(s.status, 'none') end as link_cloud_sync_status
      from download_lead_links k
      join "user" u on u.id = k.user_id
      left join subscriptions s on s.user_id = k.user_id
      where k.lead_id = l.id
    ) k on true`;

/**
 * Leases due events to one worker. At most one event per lead is handed out
 * at a time, across all types, so a batch never races itself on one contact.
 * A linked event waits until the lead's earlier download events are synced,
 * so its MailCheap contact exists first.
 */
export async function claimDownloadEvents(
  options: {
    limit?: number;
    now?: Date;
    eventTypes?: readonly DownloadEventType[];
    /** Origin for accountLinkUrl, e.g. https://www.doodlenote.ai. */
    baseUrl?: string;
    secret?: string;
  } = {},
  db: Db = getDb(),
): Promise<ClaimedDownloadEvent[]> {
  const limit = Math.max(1, Math.min(MAX_CLAIM_LIMIT, Math.floor(options.limit ?? 25)));
  const eventTypes = options.eventTypes?.length ? options.eventTypes : [DOWNLOAD_EVENT_TYPE];
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS).toISOString();
  const types = sql.join(eventTypes.map((type) => sql`${type}`), sql`, `);
  const result = await db.execute(sql`
    with candidates as (
      select id from (
        select distinct on (e.lead_id) e.id, e.created_at
        from download_lead_events e
        where e.sync_status = 'pending'
          and e.event_type in (${types})
          and e.next_attempt_at <= ${nowIso}::timestamptz
          and not exists (
            select 1 from download_lead_events held
            where held.lead_id = e.lead_id
              and held.sync_status = 'pending'
              and held.claimed_at >= ${staleBefore}::timestamptz
          )
          and not (
            e.event_type = ${DOWNLOAD_LINKED_EVENT_TYPE}
            and exists (
              select 1 from download_lead_events earlier
              where earlier.lead_id = e.lead_id
                and earlier.sync_status = 'pending'
                and earlier.event_type = ${DOWNLOAD_EVENT_TYPE}
                and earlier.created_at <= e.created_at
            )
          )
        order by e.lead_id, e.created_at
      ) first_per_lead
      order by created_at
      limit ${limit}
    ), claimed as (
      update download_lead_events e set
        claim_token = gen_random_uuid(),
        claimed_at = ${nowIso}::timestamptz,
        attempts = e.attempts + 1,
        updated_at = ${nowIso}::timestamptz
      where e.id in (select id from candidates)
        and e.sync_status = 'pending'
        and (e.claimed_at is null or e.claimed_at < ${staleBefore}::timestamptz)
      returning e.id, e.claim_token, e.lead_id, e.event_type, e.platform, e.requested_at, e.attempts, e.created_at
    )
    select
      c.id, c.claim_token, c.event_type, c.platform, c.requested_at, c.attempts,
      l.id as lead_id, l.email, l.source, l.first_requested_at, l.latest_requested_at,
      l.request_count, l.marketing_consent, l.marketing_consent_at, l.marketing_consent_version,
      a.user_id, a.stripe_customer_id, a.cloud_sync_status,
      k.link_user_id, k.link_verified_at, k.link_account_email, k.link_stripe_customer_id, k.link_cloud_sync_status
    from claimed c
    join download_leads l on l.id = c.lead_id
    ${accountJoins}
    order by c.created_at
  `);
  const baseUrl = options.baseUrl ?? DEFAULT_SITE_URL;
  return rows(result).flatMap((row): ClaimedDownloadEvent[] => {
    const base: ClaimedEventBase = {
      eventId: String(row.id),
      claimToken: String(row.claim_token),
      attempt: Number(row.attempts),
      leadId: String(row.lead_id),
      email: String(row.email),
      source: String(row.source),
      firstRequestedAt: iso(row.first_requested_at)!,
      latestRequestedAt: iso(row.latest_requested_at)!,
      requestCount: Number(row.request_count),
      marketingConsent: {
        granted: row.marketing_consent === true,
        grantedAt: iso(row.marketing_consent_at),
        version: row.marketing_consent_version ? String(row.marketing_consent_version) : null,
      },
      account: account(row),
    };
    if (row.event_type === DOWNLOAD_LINKED_EVENT_TYPE) {
      const linked = link(row);
      // A link removed after its event was queued (account deleted) has nothing to report.
      return linked ? [{ ...base, eventType: DOWNLOAD_LINKED_EVENT_TYPE, link: linked }] : [];
    }
    return [
      {
        ...base,
        eventType: DOWNLOAD_EVENT_TYPE,
        platform: row.platform as DownloadPlatform,
        requestedAt: iso(row.requested_at)!,
        freeDownloadLifecycleEligible: !base.account.exists,
        accountLinkUrl: downloadLeadLinkUrl(
          baseUrl,
          { leadId: base.leadId, email: base.email },
          now.getTime(),
          options.secret,
        ),
      },
    ];
  });
}

export const MAX_LOOKUP_EMAILS = 100;

export interface DownloadLeadLookup {
  /** The address as given, trimmed and lowercased. */
  email: string;
  valid: boolean;
  /** The download lead for this address, if it ever submitted the form. */
  lead: {
    leadId: string;
    firstRequestedAt: string;
    latestRequestedAt: string;
    requestCount: number;
    marketingConsent: { granted: boolean; grantedAt: string | null; version: string | null };
    accountLinkUrl: string;
    /** The verified account link for this download address, if confirmed. */
    link: DownloadLeadLink | null;
  } | null;
  /** The account registered with this exact address, if any. */
  account: DownloadLeadAccount;
  /** Download addresses verified as belonging to the account with this address. */
  linkedDownloadEmails: { leadId: string; email: string; verifiedAt: string }[];
}

/**
 * Read-only identity view for n8n's recheck before a send: for each address,
 * its download lead, any verified link, and the account registered with it.
 * Payment status is still Stripe's to decide.
 */
export async function lookupDownloadLeads(
  emails: readonly string[],
  options: { now?: Date; baseUrl?: string; secret?: string } = {},
  db: Db = getDb(),
): Promise<DownloadLeadLookup[]> {
  const normalized = emails.map((email) => ({
    email: typeof email === "string" ? email.trim().toLowerCase() : "",
    valid: normalizeLeadEmail(email) !== null,
  }));
  const valid = [...new Set(normalized.filter((entry) => entry.valid).map((entry) => entry.email))];
  const byEmail = new Map<string, Row>();
  if (valid.length) {
    const input = sql.join(valid.map((email) => sql`(${email}::text)`), sql`, `);
    const result = await db.execute(sql`
      with input(email) as (values ${input})
      select i.email as input_email,
        l.id as lead_id, l.email, l.first_requested_at, l.latest_requested_at, l.request_count,
        l.marketing_consent, l.marketing_consent_at, l.marketing_consent_version,
        a.user_id, a.stripe_customer_id, a.cloud_sync_status,
        k.link_user_id, k.link_verified_at, k.link_account_email, k.link_stripe_customer_id, k.link_cloud_sync_status,
        (
          select coalesce(json_agg(json_build_object(
            'leadId', dl.id, 'email', dl.email, 'verifiedAt', kk.verified_at
          ) order by kk.verified_at), '[]'::json)
          from "user" au
          join download_lead_links kk on kk.user_id = au.id
          join download_leads dl on dl.id = kk.lead_id
          where lower(au.email) = i.email
        ) as linked_download_emails
      from input i
      left join download_leads l on l.email = i.email
      left join lateral (
        select u.id as user_id, s.stripe_customer_id,
          case when s.grandfathered then 'grandfathered' else coalesce(s.status, 'none') end as cloud_sync_status
        from "user" u
        left join subscriptions s on s.user_id = u.id
        where lower(u.email) = i.email
        order by u.created_at
        limit 1
      ) a on true
      left join lateral (
        select k.user_id as link_user_id, k.verified_at as link_verified_at, u.email as link_account_email,
          s.stripe_customer_id as link_stripe_customer_id,
          case when s.grandfathered then 'grandfathered' else coalesce(s.status, 'none') end as link_cloud_sync_status
        from download_lead_links k
        join "user" u on u.id = k.user_id
        left join subscriptions s on s.user_id = k.user_id
        where k.lead_id = l.id
      ) k on true
    `);
    for (const row of rows(result)) byEmail.set(String(row.input_email), row);
  }
  const now = options.now ?? new Date();
  const baseUrl = options.baseUrl ?? DEFAULT_SITE_URL;
  return normalized.map(({ email, valid: isValid }) => {
    const row = byEmail.get(email);
    if (!isValid || !row) {
      return {
        email,
        valid: isValid,
        lead: null,
        account: { exists: false, userId: null, stripeCustomerId: null, cloudSyncStatus: null },
        linkedDownloadEmails: [],
      };
    }
    const linkedRaw = typeof row.linked_download_emails === "string"
      ? JSON.parse(row.linked_download_emails)
      : row.linked_download_emails;
    return {
      email,
      valid: true,
      lead: row.lead_id
        ? {
            leadId: String(row.lead_id),
            firstRequestedAt: iso(row.first_requested_at)!,
            latestRequestedAt: iso(row.latest_requested_at)!,
            requestCount: Number(row.request_count),
            marketingConsent: {
              granted: row.marketing_consent === true,
              grantedAt: iso(row.marketing_consent_at),
              version: row.marketing_consent_version ? String(row.marketing_consent_version) : null,
            },
            accountLinkUrl: downloadLeadLinkUrl(
              baseUrl,
              { leadId: String(row.lead_id), email },
              now.getTime(),
              options.secret,
            ),
            link: link(row),
          }
        : null,
      account: account(row),
      linkedDownloadEmails: ((linkedRaw ?? []) as Row[]).map((entry) => ({
        leadId: String(entry.leadId),
        email: String(entry.email),
        verifiedAt: iso(entry.verifiedAt)!,
      })),
    };
  });
}

export type DownloadEventResult =
  | { eventId: string; claimToken: string; result: "synced"; outcome: string; mailcheapContactId?: string | null }
  | { eventId: string; claimToken: string; result: "skipped"; outcome: string; error?: string | null }
  | { eventId: string; claimToken: string; result: "retry"; error: string };

const OUTCOME = /^[a-z_]{1,64}$/;

/** Validates one acknowledgement from n8n; null when it can't be trusted. */
export function parseDownloadEventResult(value: unknown): DownloadEventResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const { eventId, claimToken, result } = input;
  if (typeof eventId !== "string" || !UUID.test(eventId)) return null;
  if (typeof claimToken !== "string" || !UUID.test(claimToken)) return null;
  const error =
    typeof input.error === "string" ? input.error.slice(0, MAX_ERROR_LENGTH) : null;
  const outcome = typeof input.outcome === "string" && OUTCOME.test(input.outcome) ? input.outcome : null;
  if (result === "synced" && outcome) {
    const contact = input.mailcheapContactId;
    return {
      eventId,
      claimToken,
      result,
      outcome,
      mailcheapContactId:
        typeof contact === "string" && contact.length <= 64 ? contact : null,
    };
  }
  if (result === "skipped" && outcome) return { eventId, claimToken, result, outcome, error };
  if (result === "retry") return { eventId, claimToken, result, error: error ?? "retry requested" };
  return null;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * Applies results only for the claim that is still current: a worker whose
 * lease expired and was re-claimed cannot overwrite the newer attempt.
 */
export async function acknowledgeDownloadEvents(
  results: DownloadEventResult[],
  options: { now?: Date } = {},
  db: Db = getDb(),
): Promise<{ acknowledged: string[]; stale: string[] }> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const acknowledged: string[] = [];
  const stale: string[] = [];
  for (const item of results) {
    const current = sql`id = ${item.eventId}::uuid and claim_token = ${item.claimToken}::uuid and sync_status = 'pending'`;
    let result: unknown;
    if (item.result === "synced") {
      result = await db.execute(sql`
        update download_lead_events set
          sync_status = 'synced', synced_at = ${nowIso}::timestamptz, sync_outcome = ${item.outcome},
          mailcheap_contact_id = ${item.mailcheapContactId ?? null}, last_error = null,
          claim_token = null, claimed_at = null, updated_at = ${nowIso}::timestamptz
        where ${current} returning id`);
    } else if (item.result === "skipped") {
      result = await db.execute(sql`
        update download_lead_events set
          sync_status = 'skipped', sync_outcome = ${item.outcome}, last_error = ${item.error ?? null},
          claim_token = null, claimed_at = null, updated_at = ${nowIso}::timestamptz
        where ${current} returning id`);
    } else {
      result = await db.execute(sql`
        update download_lead_events set
          last_error = ${item.error},
          next_attempt_at = ${nowIso}::timestamptz + least(
            ${MAX_RETRY_MS}::float8, ${FIRST_RETRY_MS}::float8 * power(2, greatest(attempts - 1, 0))
          ) * interval '1 millisecond',
          claim_token = null, claimed_at = null, updated_at = ${nowIso}::timestamptz
        where ${current} returning id`);
    }
    (rows(result).length ? acknowledged : stale).push(item.eventId);
  }
  return { acknowledged, stale };
}

/** The public origin for links n8n puts in emails; matches billing's redirect origin. */
export function siteOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

/** n8n authenticates with its own bearer secret, separate from the cron secret. */
export function downloadSyncAuthorization(
  request: Request,
  secret = process.env.DOWNLOAD_LEADS_SYNC_SECRET,
): "unconfigured" | "unauthorized" | "authorized" {
  if (!secret) return "unconfigured";
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? "authorized"
    : "unauthorized";
}
