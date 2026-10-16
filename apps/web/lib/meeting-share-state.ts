/**
 * The meeting Share panel's state and settings (DEV-485).
 *
 * One object describes everything the panel shows, on web and desktop:
 *
 *   {
 *     includeTranscript,              // ONE setting for everyone: people added and the link
 *     link: { url, expiresAt } | null, // "Anyone with the link"; null = "Only people added"
 *     recipients: [{ id, email, createdAt }],
 *     workspace: { name, personal, memberCount }, // who already sees it
 *     limits: { perRequest, perMeeting },
 *   }
 *
 * `meetings.share_include_transcript` is the single source of truth for
 * transcript visibility (public reader and per-person recipients alike);
 * `meetings.share_token` / `share_expires_at` are the public link. An expired
 * link reads as off, and turning the link on again mints a fresh token, so an
 * expired URL never comes back to life.
 *
 * Writes touch only those three share columns of `meetings` (the same writes
 * the public-link route has always made; they pass the sync_guard_legacy
 * trigger, which refuses rows the v2 sync engine owns). Callers authorize
 * first (workspace membership on web, the device's workspace for bearer).
 *
 * Deliberately free of `server-only`/Next imports so tests and the desktop
 * bearer route can reuse it.
 */
import { randomBytes } from "node:crypto";

import { eq, meetings, organization, sql, type Db } from "@repo/db";

import {
  MAX_RECIPIENTS_PER_MEETING,
  MAX_RECIPIENTS_PER_REQUEST,
  listMeetingRecipients,
  type MeetingRecipient,
} from "./meeting-recipients";

/** Public-link lifetimes the panel offers, in days; 0 = never expires (the default). */
export const LINK_EXPIRY_DAYS = [0, 1, 7, 30] as const;
export type LinkExpiryDays = (typeof LINK_EXPIRY_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

type SqlValue = ReturnType<typeof sql>;

export interface MeetingShareLink {
  url: string;
  /** ISO timestamp, or null when the link never expires. */
  expiresAt: string | null;
}

export interface MeetingShareWorkspace {
  name: string;
  /** A Personal workspace: only its owner sees the meeting. */
  personal: boolean;
  memberCount: number;
}

export interface MeetingShareState {
  includeTranscript: boolean;
  link: MeetingShareLink | null;
  recipients: MeetingRecipient[];
  workspace: MeetingShareWorkspace;
  limits: { perRequest: number; perMeeting: number };
}

/** A validated settings change; every field is optional. */
export interface ShareSettingsUpdate {
  includeTranscript?: boolean;
  link?: "on" | "off";
  expiresInDays?: LinkExpiryDays;
}

export type ShareSettingsErrorCode =
  | "invalid_body"
  | "invalid_include_transcript"
  | "invalid_link"
  | "invalid_expiry"
  | "nothing_to_update"
  | "link_off"
  | "sync_upgrade_required";

export interface ShareSettingsError {
  status: 400 | 409;
  code: ShareSettingsErrorCode;
  error: string;
}

/** Canonical public origin for share URLs. */
export function shareOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

/** True when the meeting has a public link that has not expired. */
export function isLinkActive(
  row: { shareToken: string | null; shareExpiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  return Boolean(row.shareToken) && (!row.shareExpiresAt || row.shareExpiresAt > now);
}

function invalid(code: ShareSettingsErrorCode, error: string): { ok: false } & ShareSettingsError {
  return { ok: false, status: 400, code, error };
}

/**
 * Validates a POST body: `{ includeTranscript?, link?: "on"|"off",
 * expiresInDays?: 0|1|7|30 }`. For older clients `enable: true|false` is read
 * as `link: "on"|"off"` when `link` is absent; it never touches the
 * transcript setting on its own.
 */
export function parseShareSettingsUpdate(
  body: unknown,
): { ok: true; update: ShareSettingsUpdate } | ({ ok: false } & ShareSettingsError) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid("invalid_body", "Invalid JSON");
  }
  const raw = body as {
    includeTranscript?: unknown;
    link?: unknown;
    enable?: unknown;
    expiresInDays?: unknown;
  };
  const update: ShareSettingsUpdate = {};

  if (raw.includeTranscript !== undefined) {
    if (typeof raw.includeTranscript !== "boolean") {
      return invalid("invalid_include_transcript", "includeTranscript must be true or false");
    }
    update.includeTranscript = raw.includeTranscript;
  }

  if (raw.link !== undefined) {
    if (raw.link !== "on" && raw.link !== "off") {
      return invalid("invalid_link", 'link must be "on" or "off"');
    }
    update.link = raw.link;
  } else if (raw.enable !== undefined) {
    if (typeof raw.enable !== "boolean") {
      return invalid("invalid_link", "enable must be true or false");
    }
    update.link = raw.enable ? "on" : "off";
  }

  if (raw.expiresInDays !== undefined) {
    const days = typeof raw.expiresInDays === "string" ? Number(raw.expiresInDays) : raw.expiresInDays;
    if (typeof days !== "number" || !(LINK_EXPIRY_DAYS as readonly number[]).includes(days)) {
      return invalid("invalid_expiry", "expiresInDays must be 0, 1, 7, or 30");
    }
    if (update.link === "off") {
      return invalid("invalid_expiry", "A link that is turned off has no expiry");
    }
    update.expiresInDays = days as LinkExpiryDays;
  }

  if (
    update.includeTranscript === undefined &&
    update.link === undefined &&
    update.expiresInDays === undefined
  ) {
    return invalid("nothing_to_update", "Nothing to update");
  }
  return { ok: true, update };
}

/** The trigger on `meetings` refuses rows the v2 sync engine owns. */
function isSyncUpgradeRequired(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error && current.message.includes("sync_upgrade_required")) return true;
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

const SYNC_UPGRADE_REQUIRED_ERROR =
  "This meeting's sharing settings can't be changed right now. Update DoodleNote on your computer, sync, and try again.";

/**
 * Applies a validated update in one UPDATE of the meeting's share columns.
 * Turning the link on keeps a still-active token (so concurrent "on"
 * requests agree on one URL) and otherwise mints a new one with no expiry
 * unless `expiresInDays` says otherwise. Turning it off clears the token and
 * expiry. Changing only the expiry requires an active link (409 `link_off`).
 * Unchanged settings are not written. `notFound` when there is no meeting.
 */
export async function updateMeetingShareSettings(
  db: Db,
  meetingId: string,
  update: ShareSettingsUpdate,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; notFound: true } | ({ ok: false; notFound?: false } & ShareSettingsError)> {
  const current = (
    await db
      .select({
        shareToken: meetings.shareToken,
        shareExpiresAt: meetings.shareExpiresAt,
        shareIncludeTranscript: meetings.shareIncludeTranscript,
      })
      .from(meetings)
      .where(eq(meetings.id, meetingId))
      .limit(1)
  )[0];
  if (!current) return { ok: false, notFound: true };

  const linkOn = update.link === "on" || (update.link === undefined && isLinkActive(current, now));
  if (update.expiresInDays !== undefined && !linkOn) {
    return {
      ok: false,
      status: 409,
      code: "link_off",
      error: "Turn on “Anyone with the link” before choosing when it expires.",
    };
  }

  const set: {
    shareIncludeTranscript?: boolean;
    shareToken?: string | null | SqlValue;
    shareExpiresAt?: Date | null | SqlValue;
  } = {};
  if (update.includeTranscript !== undefined && update.includeTranscript !== current.shareIncludeTranscript) {
    set.shareIncludeTranscript = update.includeTranscript;
  }
  const chosenExpiry =
    update.expiresInDays === undefined
      ? undefined
      : update.expiresInDays === 0
        ? null
        : new Date(now.getTime() + update.expiresInDays * DAY_MS);
  // Expired links count as off, in SQL too, so a racing request sees the same thing.
  const active = sql`(${meetings.shareToken} is not null and (${meetings.shareExpiresAt} is null or ${meetings.shareExpiresAt} > ${now.toISOString()}::timestamptz))`;
  if (update.link === "on" && isLinkActive(current, now) && chosenExpiry === undefined) {
    // Already on: nothing to write (older desktops send this on every share).
  } else if (update.link === "on") {
    const fresh = randomBytes(16).toString("hex");
    set.shareToken = sql`case when ${active} then ${meetings.shareToken} else ${fresh} end`;
    set.shareExpiresAt =
      chosenExpiry !== undefined
        ? chosenExpiry
        : sql`case when ${active} then ${meetings.shareExpiresAt} else null end`;
  } else if (update.link === "off") {
    if (current.shareToken !== null || current.shareExpiresAt !== null) {
      set.shareToken = null;
      set.shareExpiresAt = null;
    }
  } else if (chosenExpiry !== undefined) {
    set.shareExpiresAt = chosenExpiry;
  }

  // Nothing changes (e.g. the transcript toggle already has this value):
  // skip the write so the meeting's sync clock is not bumped for no reason.
  if (Object.keys(set).length === 0) return { ok: true };

  try {
    await db
      .update(meetings)
      .set({ ...set, updatedAt: now })
      .where(eq(meetings.id, meetingId));
  } catch (error) {
    if (isSyncUpgradeRequired(error)) {
      return { ok: false, status: 409, code: "sync_upgrade_required", error: SYNC_UPGRADE_REQUIRED_ERROR };
    }
    throw error;
  }
  return { ok: true };
}

/** Everything the Share panel shows. Null when the meeting does not exist. */
export async function readMeetingShareState(
  db: Db,
  input: { meetingId: string; origin: string; now?: Date },
): Promise<MeetingShareState | null> {
  const rows = await db
    .select({
      shareToken: meetings.shareToken,
      shareExpiresAt: meetings.shareExpiresAt,
      shareIncludeTranscript: meetings.shareIncludeTranscript,
      workspaceName: organization.name,
      workspaceSlug: organization.slug,
      memberCount: sql<number>`(select count(*)::int from member where member.organization_id = ${meetings.organizationId})`,
    })
    .from(meetings)
    .innerJoin(organization, eq(organization.id, meetings.organizationId))
    .where(eq(meetings.id, input.meetingId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const recipients = await listMeetingRecipients(db, input.meetingId);
  const active = isLinkActive(row, input.now);
  return {
    includeTranscript: row.shareIncludeTranscript,
    link:
      active && row.shareToken
        ? {
            url: `${input.origin}/share/${row.shareToken}`,
            expiresAt: row.shareExpiresAt?.toISOString() ?? null,
          }
        : null,
    recipients,
    workspace: {
      name: row.workspaceName,
      personal: row.workspaceSlug.startsWith("personal-"),
      memberCount: Number(row.memberCount),
    },
    limits: { perRequest: MAX_RECIPIENTS_PER_REQUEST, perMeeting: MAX_RECIPIENTS_PER_MEETING },
  };
}

const noStore = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

/**
 * Applies `update` and returns the new state as an HTTP response, or the
 * validation/conflict error. Shared by the session and bearer routes.
 */
export async function shareSettingsResponse(
  db: Db,
  input: { meetingId: string; origin: string; update: ShareSettingsUpdate; extra?: (state: MeetingShareState) => Record<string, unknown> },
): Promise<Response> {
  const result = await updateMeetingShareSettings(db, input.meetingId, input.update);
  if (!result.ok) {
    if (result.notFound) return json({ error: "Meeting not found" }, 404);
    return json({ error: result.error, code: result.code }, result.status);
  }
  const state = await readMeetingShareState(db, input);
  if (!state) return json({ error: "Meeting not found" }, 404);
  return json({ ok: true, ...input.extra?.(state), ...state });
}

/**
 * Transport-neutral handler for /api/meetings/[id]/share. GET returns the
 * share state; POST applies `{ includeTranscript?, link?, expiresInDays? }`
 * and returns the new state. `meetingId: null` (not a workspace member, or
 * no such meeting) yields 404 for every method.
 */
export async function handleMeetingShareRequest(
  request: Request,
  deps: { db: Db; meetingId: string | null },
): Promise<Response> {
  const { db, meetingId } = deps;
  if (!meetingId) return json({ error: "Meeting not found" }, 404);
  const origin = shareOrigin(request);

  if (request.method === "GET") {
    const state = await readMeetingShareState(db, { meetingId, origin });
    if (!state) return json({ error: "Meeting not found" }, 404);
    return json({ ok: true, ...state });
  }

  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON", code: "invalid_body" }, 400);
    }
    const parsed = parseShareSettingsUpdate(body);
    if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status);
    return shareSettingsResponse(db, { meetingId, origin, update: parsed.update });
  }

  return json({ error: "Method not allowed" }, 405);
}
