/**
 * Desktop sharing over the bearer sync token (DEV-486).
 *
 * The desktop app authenticates with its device token, so the acting user is
 * `device.userId` and a meeting is manageable only when it is already synced
 * into the device's workspace (`organizationId = device.organizationId`).
 * Anything else — another workspace's meeting, or one the desktop has not
 * pushed yet — gets the same 404 so the desktop can tell the user to sync.
 *
 * Share with people delegates to the DEV-485 handler, so validation, caps,
 * no-enumeration responses and notifications are identical to the web app.
 *
 * Framework-free (no `server-only`/Next imports) so tests can exercise it;
 * the route files only wire `getDb()` and `after()`.
 */
import { randomBytes } from "node:crypto";

import { and, eq, meetings, user, type Db } from "@repo/db";

import {
  handleMeetingRecipientsRequest,
  type RecipientsAddedEvent,
} from "./meeting-recipients-http";
import { authenticateEntitledSyncRequest, type SyncDeviceAuth } from "./sync-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MEETING_NOT_SYNCED = "Meeting not synced yet — sync it first";

/** Public-link lifetimes the web Share panel offers; 0 = never expires. */
const EXPIRY_DAYS = [0, 1, 7, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

const noStore = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

/** Canonical public origin for share URLs. */
function shareOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
}

/** The meeting when it is synced into the device's workspace, else null. */
async function findDeviceMeeting(db: Db, device: SyncDeviceAuth, meetingId: string) {
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      shareToken: meetings.shareToken,
      shareIncludeTranscript: meetings.shareIncludeTranscript,
      shareExpiresAt: meetings.shareExpiresAt,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.organizationId, device.organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

type DeviceMeeting = NonNullable<Awaited<ReturnType<typeof findDeviceMeeting>>>;

/** Current public-link settings; a revoked link reports url: null. */
function linkState(
  origin: string,
  meeting: Pick<DeviceMeeting, "shareToken" | "shareIncludeTranscript" | "shareExpiresAt">,
) {
  if (!meeting.shareToken) {
    return { url: null, includeTranscript: false, expiresAt: null };
  }
  return {
    url: `${origin}/share/${meeting.shareToken}`,
    includeTranscript: meeting.shareIncludeTranscript,
    expiresAt: meeting.shareExpiresAt?.toISOString() ?? null,
  };
}

/**
 * GET/POST/DELETE /api/sync/share/recipients?meetingId=<uuid>.
 * Same bodies and responses as /api/meetings/[id]/recipients.
 */
export async function handleSyncRecipientsRequest(
  request: Request,
  deps: { db: Db; onRecipientsAdded?: (event: RecipientsAddedEvent) => void },
): Promise<Response> {
  const authed = await authenticateEntitledSyncRequest(request);
  if (authed.response) return authed.response;
  const { device } = authed;

  const meetingId = new URL(request.url).searchParams.get("meetingId") ?? "";
  if (!UUID_RE.test(meetingId)) return json({ error: "meetingId must be a UUID" }, 400);
  const meeting = await findDeviceMeeting(deps.db, device, meetingId);
  if (!meeting) return json({ error: MEETING_NOT_SYNCED }, 404);

  const sharer = (
    await deps.db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, device.userId))
      .limit(1)
  )[0];
  if (!sharer) return json({ error: "Invalid sync token" }, 401);

  return handleMeetingRecipientsRequest(request, {
    db: deps.db,
    access: {
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      userId: device.userId,
      userEmail: sharer.email,
      userName: sharer.name,
    },
    onRecipientsAdded: deps.onRecipientsAdded,
  });
}

/**
 * /api/sync/share — the meeting's public link.
 *
 * GET ?meetingId= returns the current settings.
 * POST { meetingId, enable, includeTranscript?, expiresInDays? } creates,
 * updates or (enable:false) revokes it. Desktop builds before DEV-486 send
 * only { meetingId, enable }: a new link then gets the old notes-only,
 * never-expiring defaults and an existing link keeps its settings. Every
 * response includes { url, includeTranscript, expiresAt }.
 */
export async function handleSyncShareRequest(
  request: Request,
  deps: { db: Db },
): Promise<Response> {
  const authed = await authenticateEntitledSyncRequest(request);
  if (authed.response) return authed.response;
  const { device } = authed;
  const { db } = deps;
  const origin = shareOrigin(request);

  if (request.method === "GET") {
    const meetingId = new URL(request.url).searchParams.get("meetingId") ?? "";
    if (!UUID_RE.test(meetingId)) return json({ error: "meetingId must be a UUID" }, 400);
    const meeting = await findDeviceMeeting(db, device, meetingId);
    if (!meeting) return json({ error: MEETING_NOT_SYNCED }, 404);
    return json({ ok: true, ...linkState(origin, meeting) });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    meetingId?: unknown;
    enable?: unknown;
    includeTranscript?: unknown;
    expiresInDays?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
    if (!body || typeof body !== "object") throw new Error("invalid_body");
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const meetingId = String(body.meetingId ?? "");
  if (!UUID_RE.test(meetingId)) return json({ error: "meetingId must be a UUID" }, 400);
  const enable = body.enable !== false;

  // Options are optional so older desktop builds keep working unchanged.
  let includeTranscript: boolean | undefined;
  let expiresInDays: number | undefined;
  if (enable) {
    if (body.includeTranscript !== undefined) {
      if (typeof body.includeTranscript !== "boolean") {
        return json({ error: "includeTranscript must be true or false" }, 400);
      }
      includeTranscript = body.includeTranscript;
    }
    if (body.expiresInDays !== undefined) {
      // Same rule as the web Share panel (/api/meetings/[id]/share).
      expiresInDays = Number(body.expiresInDays ?? 0);
      if (!EXPIRY_DAYS.includes(expiresInDays)) {
        return json({ error: "expiresInDays must be 0, 1, 7, or 30" }, 400);
      }
    }
  }

  const meeting = await findDeviceMeeting(db, device, meetingId);
  if (!meeting) return json({ error: MEETING_NOT_SYNCED }, 404);

  if (!enable) {
    await db
      .update(meetings)
      .set({ shareToken: null, shareExpiresAt: null })
      .where(eq(meetings.id, meeting.id));
    return json({ ok: true, ...linkState(origin, { ...meeting, shareToken: null }) });
  }

  const isNew = !meeting.shareToken;
  const next = {
    shareToken: meeting.shareToken ?? randomBytes(16).toString("hex"),
    // A new link starts notes-only and never-expiring unless asked otherwise;
    // an existing link keeps whatever was not explicitly changed.
    shareIncludeTranscript: includeTranscript ?? (isNew ? false : meeting.shareIncludeTranscript),
    shareExpiresAt:
      expiresInDays !== undefined
        ? expiresInDays === 0
          ? null
          : new Date(Date.now() + expiresInDays * DAY_MS)
        : isNew
          ? null
          : meeting.shareExpiresAt,
  };
  const changed =
    isNew ||
    next.shareIncludeTranscript !== meeting.shareIncludeTranscript ||
    next.shareExpiresAt?.getTime() !== meeting.shareExpiresAt?.getTime();
  if (changed) {
    await db.update(meetings).set(next).where(eq(meetings.id, meeting.id));
  }
  return json({ ok: true, ...linkState(origin, next) });
}
