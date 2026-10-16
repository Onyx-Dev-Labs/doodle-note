/**
 * Share-with-people service (DEV-485): per-person, read-only meeting access.
 *
 * Every function takes the database explicitly so session routes (web) and
 * future bearer-token routes (desktop, DEV-486) share one implementation:
 * callers authenticate and authorize first (only a caller that passes the
 * workspace-membership check may manage recipients), then pass
 * `sharedByUserId` = the acting user id.
 *
 * Access rules:
 * - A share row grants the matching user read-only access to exactly one
 *   meeting: notes, Copy notes, Export .md, and the transcript when the
 *   meeting-level `meetings.share_include_transcript` is on (the same one
 *   setting governs the public link; see meeting-share-state.ts). No
 *   folders, tags, other meetings, or mutations.
 * - A user matches a row by `recipient_user_id`, or — while the row is still
 *   unattached — by normalized email. When email verification is enabled
 *   (`resolveAuthEmailEnabled()`, always true in production) only a VERIFIED
 *   account email may match; with verification disabled (local development
 *   only) any account email matches so localhost testing works. A matching
 *   row is lazily attached to that user id.
 * - Owner-facing results never reveal whether an address has an account.
 *
 * Deliberately free of `server-only`/Next imports so tests can exercise it.
 */
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  meetings,
  meetingShares,
  notes,
  or,
  sql,
  transcriptSegments,
  user,
  type Db,
} from "@repo/db";

import { markdownOf } from "./meeting-content";

/** Most addresses accepted in one POST. */
export const MAX_RECIPIENTS_PER_REQUEST = 20;
/** Most people one meeting can be shared with (soft cap, checked before insert). */
export const MAX_RECIPIENTS_PER_MEETING = 50;

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner-facing recipient row. Intentionally has no account information. */
export interface MeetingRecipient {
  id: string;
  email: string;
  createdAt: string;
}

/** The signed-in identity whose shared access is being resolved. */
export interface ShareRecipientIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
}

export type RecipientErrorCode =
  | "no_emails"
  | "invalid_email"
  | "duplicate_email"
  | "self_share"
  | "too_many_emails"
  | "recipient_limit"
  | "already_shared";

export interface RecipientError {
  status: 400 | 409;
  code: RecipientErrorCode;
  error: string;
  emails?: string[];
}

export type AddRecipientsResult =
  | { ok: true; added: MeetingRecipient[] }
  | ({ ok: false } & RecipientError);

/** Trimmed, lowercase email, or null when it is not a plausible address. */
export function normalizeRecipientEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) {
    return null;
  }
  return email;
}

/** Accepts an array of strings or one string separated by commas, semicolons, or whitespace. */
export function splitRecipientInput(input: unknown): string[] {
  const parts = Array.isArray(input)
    ? input.flatMap((value) => (typeof value === "string" ? [value] : [String(value)]))
    : typeof input === "string"
      ? [input]
      : [];
  return parts
    .flatMap((part) => part.split(/[\s,;]+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Validates and normalizes a request's addresses. All-or-nothing: any
 * invalid, duplicated, or self address rejects the whole request.
 */
export function validateRecipientEmails(
  input: unknown,
  sharerEmail: string,
): { ok: true; emails: string[] } | ({ ok: false } & RecipientError) {
  const raw = splitRecipientInput(input);
  if (raw.length === 0) {
    return { ok: false, status: 400, code: "no_emails", error: "Enter at least one email address." };
  }
  if (raw.length > MAX_RECIPIENTS_PER_REQUEST) {
    return {
      ok: false,
      status: 400,
      code: "too_many_emails",
      error: `Share with at most ${MAX_RECIPIENTS_PER_REQUEST} people at a time.`,
    };
  }
  const invalid = raw.filter((value) => normalizeRecipientEmail(value) === null);
  if (invalid.length > 0) {
    return {
      ok: false,
      status: 400,
      code: "invalid_email",
      error: `Not a valid email address: ${invalid.join(", ")}`,
      emails: invalid,
    };
  }
  const emails = raw.map((value) => normalizeRecipientEmail(value)!);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const email of emails) {
    if (seen.has(email)) duplicates.add(email);
    seen.add(email);
  }
  if (duplicates.size > 0) {
    return {
      ok: false,
      status: 400,
      code: "duplicate_email",
      error: `Listed more than once: ${[...duplicates].join(", ")}`,
      emails: [...duplicates],
    };
  }
  if (emails.includes(sharerEmail.trim().toLowerCase())) {
    return {
      ok: false,
      status: 400,
      code: "self_share",
      error: "You already have access to this meeting.",
      emails: [sharerEmail.trim().toLowerCase()],
    };
  }
  return { ok: true, emails };
}

function toRecipient(row: {
  id: string;
  recipientEmail: string;
  createdAt: Date;
}): MeetingRecipient {
  return {
    id: row.id,
    email: row.recipientEmail,
    createdAt: row.createdAt.toISOString(),
  };
}

const recipientColumns = {
  id: meetingShares.id,
  recipientEmail: meetingShares.recipientEmail,
  createdAt: meetingShares.createdAt,
};

/** Everyone the meeting is shared with, oldest first. Caller must be authorized to manage the meeting. */
export async function listMeetingRecipients(
  db: Db,
  meetingId: string,
): Promise<MeetingRecipient[]> {
  const rows = await db
    .select(recipientColumns)
    .from(meetingShares)
    .where(eq(meetingShares.meetingId, meetingId))
    .orderBy(asc(meetingShares.createdAt), asc(meetingShares.recipientEmail));
  return rows.map(toRecipient);
}

function isUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && "code" in current && (current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/**
 * Shares one meeting with up to MAX_RECIPIENTS_PER_REQUEST addresses in a
 * single INSERT, so a rejected request never leaves partial rows. The result
 * is identical whether or not an address belongs to an existing account.
 * Caller must already be authorized to manage the meeting (getMeetingAccess).
 */
export async function addMeetingRecipients(
  db: Db,
  input: {
    meetingId: string;
    sharedByUserId: string;
    sharedByEmail: string;
    emails: unknown;
  },
): Promise<AddRecipientsResult> {
  const validated = validateRecipientEmails(input.emails, input.sharedByEmail);
  if (!validated.ok) return validated;
  const { emails } = validated;

  const existing = await db
    .select({ email: meetingShares.recipientEmail })
    .from(meetingShares)
    .where(eq(meetingShares.meetingId, input.meetingId));
  const existingEmails = new Set(existing.map((row) => row.email));
  const alreadyShared = emails.filter((email) => existingEmails.has(email));
  if (alreadyShared.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "already_shared",
      error: `Already shared with ${alreadyShared.join(", ")}`,
      emails: alreadyShared,
    };
  }
  if (existing.length + emails.length > MAX_RECIPIENTS_PER_MEETING) {
    return {
      ok: false,
      status: 400,
      code: "recipient_limit",
      error: `A meeting can be shared with at most ${MAX_RECIPIENTS_PER_MEETING} people. Remove someone first.`,
    };
  }

  try {
    const rows = await db
      .insert(meetingShares)
      .values(
        emails.map((recipientEmail) => ({
          meetingId: input.meetingId,
          recipientEmail,
          sharedByUserId: input.sharedByUserId,
        })),
      )
      .returning();
    return { ok: true, added: rows.map(toRecipient) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        code: "already_shared",
        error: "Someone in that list was just given access. Refresh and try again.",
      };
    }
    throw error;
  }
}

/** Revokes one person's access. Returns false when the row is not on this meeting. */
export async function removeMeetingRecipient(
  db: Db,
  input: { meetingId: string; recipientId: string },
): Promise<boolean> {
  if (!UUID_RE.test(input.recipientId)) return false;
  const rows = await db
    .delete(meetingShares)
    .where(
      and(
        eq(meetingShares.id, input.recipientId),
        eq(meetingShares.meetingId, input.meetingId),
      ),
    )
    .returning();
  return rows.length > 0;
}

function emailMayMatch(
  identity: ShareRecipientIdentity,
  requireVerifiedEmail: boolean,
): boolean {
  return Boolean(identity.email) && (identity.emailVerified || !requireVerifiedEmail);
}

/** SQL predicate: share rows the identity may use. */
export function shareMatchesIdentity(
  identity: ShareRecipientIdentity,
  requireVerifiedEmail: boolean,
) {
  const byUser = eq(meetingShares.recipientUserId, identity.id);
  if (!emailMayMatch(identity, requireVerifiedEmail)) return byUser;
  return or(
    byUser,
    and(
      isNull(meetingShares.recipientUserId),
      eq(meetingShares.recipientEmail, identity.email.trim().toLowerCase()),
    ),
  )!;
}

/**
 * Binds still-pending shares for the identity's email to its user id
 * (the "lazy attach" after sign-up). Best-effort bookkeeping: matching by
 * email already grants access, so failures here never deny access.
 */
export async function attachPendingShares(
  db: Db,
  identity: ShareRecipientIdentity,
  requireVerifiedEmail: boolean,
): Promise<void> {
  if (!emailMayMatch(identity, requireVerifiedEmail)) return;
  await db
    .update(meetingShares)
    .set({ recipientUserId: identity.id })
    .where(
      and(
        isNull(meetingShares.recipientUserId),
        eq(meetingShares.recipientEmail, identity.email.trim().toLowerCase()),
      ),
    );
}

export interface SharedMeetingSummary {
  meetingId: string;
  title: string;
  kind: "meeting" | "note";
  startedAt: Date | null;
  createdAt: Date | null;
  endedAt: Date | null;
  sharedAt: Date;
  sharedByEmail: string;
  sharedByName: string;
}

/** Meetings shared with the identity across every workspace, newest share first. */
export async function listMeetingsSharedWithUser(
  db: Db,
  input: { identity: ShareRecipientIdentity; requireVerifiedEmail: boolean },
): Promise<SharedMeetingSummary[]> {
  await attachPendingShares(db, input.identity, input.requireVerifiedEmail).catch(() => {});
  const rows = await db
    .select({
      meetingId: meetings.id,
      title: meetings.title,
      kind: meetings.kind,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
      endedAt: meetings.endedAt,
      sharedAt: meetingShares.createdAt,
      sharedByEmail: user.email,
      sharedByName: user.name,
    })
    .from(meetingShares)
    .innerJoin(meetings, eq(meetings.id, meetingShares.meetingId))
    .innerJoin(user, eq(user.id, meetingShares.sharedByUserId))
    .where(shareMatchesIdentity(input.identity, input.requireVerifiedEmail))
    .orderBy(desc(meetingShares.createdAt))
    .limit(500);
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.meetingId)) return false;
    seen.add(row.meetingId);
    return true;
  });
}

export interface SharedMeetingGrant {
  meeting: typeof meetings.$inferSelect;
  /** The meeting-level `share_include_transcript` setting. */
  includeTranscript: boolean;
  sharedAt: Date;
  sharedByEmail: string;
  sharedByName: string;
}

/**
 * The identity's read-only grant for one meeting, or null. Use ONLY for read
 * paths; every mutating route must keep using workspace membership so a
 * recipient gets 404 there.
 */
export async function findSharedMeetingGrant(
  db: Db,
  input: {
    meetingId: string;
    identity: ShareRecipientIdentity;
    requireVerifiedEmail: boolean;
  },
): Promise<SharedMeetingGrant | null> {
  if (!UUID_RE.test(input.meetingId)) return null;
  const rows = await db
    .select({
      meeting: meetings,
      sharedAt: meetingShares.createdAt,
      sharedByEmail: user.email,
      sharedByName: user.name,
    })
    .from(meetingShares)
    .innerJoin(meetings, eq(meetings.id, meetingShares.meetingId))
    .innerJoin(user, eq(user.id, meetingShares.sharedByUserId))
    .where(
      and(
        eq(meetingShares.meetingId, input.meetingId),
        shareMatchesIdentity(input.identity, input.requireVerifiedEmail),
      ),
    )
    .orderBy(asc(meetingShares.createdAt))
    .limit(1);
  const first = rows[0];
  if (!first) return null;
  await attachPendingShares(db, input.identity, input.requireVerifiedEmail).catch(() => {});
  // One transcript setting for everyone the meeting is shared with.
  return { ...first, includeTranscript: first.meeting.shareIncludeTranscript };
}

export interface SharedTranscriptSegment {
  id: string;
  channel: string;
  speaker: string;
  startMs: number;
  text: string;
}

export type SharedMeetingRead =
  | { status: "not_found" }
  | {
      status: "needs_subscription" | "billing_unavailable";
      meetingId: string;
      sharedByEmail: string;
      sharedByName: string;
    }
  | {
      status: "ok";
      meeting: SharedMeetingGrant["meeting"];
      includeTranscript: boolean;
      sharedAt: Date;
      sharedByEmail: string;
      sharedByName: string;
      markdown: string | null;
      segments: SharedTranscriptSegment[];
    };

/**
 * Full read of a shared meeting for a recipient, gated on the recipient's own
 * paid entitlement. Content (notes/transcript) is loaded only when entitled,
 * and the transcript only while the meeting's share_include_transcript is on. Map statuses to
 * 404 / 402 / 503 / 200 in HTTP callers.
 */
export async function readSharedMeeting(
  db: Db,
  input: {
    meetingId: string;
    identity: ShareRecipientIdentity;
    requireVerifiedEmail: boolean;
    entitlement: (userId: string) => Promise<{ entitled: boolean; reason?: string }>;
  },
): Promise<SharedMeetingRead> {
  const grant = await findSharedMeetingGrant(db, input);
  if (!grant) return { status: "not_found" };
  const entitlement = await input.entitlement(input.identity.id);
  if (!entitlement.entitled) {
    return {
      status:
        entitlement.reason === "configuration_error"
          ? "billing_unavailable"
          : "needs_subscription",
      meetingId: grant.meeting.id,
      sharedByEmail: grant.sharedByEmail,
      sharedByName: grant.sharedByName,
    };
  }
  const [noteRows, segments] = await Promise.all([
    db
      .select({ rawContent: notes.rawContent, enhancedContent: notes.enhancedContent })
      .from(notes)
      .where(eq(notes.meetingId, grant.meeting.id))
      .limit(1),
    grant.includeTranscript
      ? db
          .select({
            id: transcriptSegments.id,
            channel: transcriptSegments.channel,
            speaker: transcriptSegments.speaker,
            startMs: transcriptSegments.startMs,
            text: transcriptSegments.text,
          })
          .from(transcriptSegments)
          .where(eq(transcriptSegments.meetingId, grant.meeting.id))
          .orderBy(asc(transcriptSegments.startMs))
          .limit(5000)
      : Promise.resolve([]),
  ]);
  return {
    status: "ok",
    meeting: grant.meeting,
    includeTranscript: grant.includeTranscript,
    sharedAt: grant.sharedAt,
    sharedByEmail: grant.sharedByEmail,
    sharedByName: grant.sharedByName,
    markdown:
      markdownOf(noteRows[0]?.enhancedContent) ?? markdownOf(noteRows[0]?.rawContent),
    segments,
  };
}

export interface ShareNotification {
  email: string;
  /** Recipient-side only (picks the email template); never returned to the owner. */
  hasAccount: boolean;
}

/** Which template each new recipient should receive. Server-internal. */
export async function planShareNotifications(
  db: Db,
  emails: string[],
): Promise<ShareNotification[]> {
  if (emails.length === 0) return [];
  const rows = await db
    .select({ email: sql<string>`lower(${user.email})` })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, emails));
  const known = new Set(rows.map((row) => row.email));
  return emails.map((email) => ({ email, hasAccount: known.has(email) }));
}
