/**
 * Desktop sharing over the bearer sync token (DEV-486).
 *
 * The desktop app authenticates with its device token, so the acting user is
 * `device.userId` and a meeting is manageable only when it is already synced
 * into the device's workspace (`organizationId = device.organizationId`).
 * Anything else — another workspace's meeting, or one the desktop has not
 * pushed yet — gets the same 404 so the desktop can tell the user to sync.
 *
 * Both routes reuse the web Share panel's logic: people via the DEV-485
 * recipients handler (same validation, caps, no-enumeration responses and
 * notifications) and settings via lib/meeting-share-state.ts (same share
 * state, including `workspace`).
 *
 * Framework-free (no `server-only`/Next imports) so tests can exercise it;
 * the route files only wire `getDb()` and `after()`.
 */
import { and, eq, meetings, user, type Db } from "@repo/db";

import {
  handleMeetingRecipientsRequest,
  type RecipientsAddedEvent,
} from "./meeting-recipients-http";
import {
  parseShareSettingsUpdate,
  readMeetingShareState,
  shareOrigin,
  shareSettingsResponse,
  type MeetingShareState,
} from "./meeting-share-state";
import { authenticateEntitledSyncRequest, type SyncDeviceAuth } from "./sync-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MEETING_NOT_SYNCED = "Meeting not synced yet — sync it first";

const noStore = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

/** The meeting when it is synced into the device's workspace, else null. */
async function findDeviceMeeting(db: Db, device: SyncDeviceAuth, meetingId: string) {
  const rows = await db
    .select({ id: meetings.id, title: meetings.title })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.organizationId, device.organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Desktop builds before DEV-486 read only the top-level `url` (null = no link). */
function withLegacyUrl(state: MeetingShareState) {
  return { url: state.link?.url ?? null };
}

/**
 * GET/POST/DELETE /api/sync/share/recipients?meetingId=<uuid>.
 * Same bodies and responses as /api/meetings/[id]/recipients: GET
 * { recipients, limits }, POST { emails }, DELETE &recipientId=.
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
 * /api/sync/share — the meeting's share state and settings, the bearer twin
 * of /api/meetings/[id]/share.
 *
 * GET ?meetingId= returns `{ ok, url, includeTranscript, link, recipients,
 * workspace, limits }`. POST { meetingId, includeTranscript?, link?:
 * "on"|"off", expiresInDays?: 0|1|7|30 } applies the change and returns the
 * same shape. Desktop builds before DEV-486 send { meetingId, enable }:
 * enable:true turns the link on (a new link never expires) WITHOUT touching
 * the meeting-level transcript setting, enable:false revokes, and `url` stays
 * at the top level for them.
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
    const state = meeting ? await readMeetingShareState(db, { meetingId: meeting.id, origin }) : null;
    if (!state) return json({ error: MEETING_NOT_SYNCED }, 404);
    return json({ ok: true, ...withLegacyUrl(state), ...state });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON", code: "invalid_body" }, 400);
  }
  const meetingId = String((body as { meetingId?: unknown } | null)?.meetingId ?? "");
  if (!UUID_RE.test(meetingId)) return json({ error: "meetingId must be a UUID" }, 400);
  const parsed = parseShareSettingsUpdate(body);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status);

  const meeting = await findDeviceMeeting(db, device, meetingId);
  if (!meeting) return json({ error: MEETING_NOT_SYNCED }, 404);
  return shareSettingsResponse(db, {
    meetingId: meeting.id,
    origin,
    update: parsed.update,
    extra: withLegacyUrl,
  });
}
