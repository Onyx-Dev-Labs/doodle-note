/**
 * Transport-neutral handler for /api/meetings/[id]/recipients. The caller
 * resolves who is acting (session for web, bearer token for DEV-486) and
 * passes `access: null` for anyone who may not manage the meeting, which
 * yields the same 404 as a missing meeting.
 */
import type { Db } from "@repo/db";

import {
  MAX_RECIPIENTS_PER_MEETING,
  MAX_RECIPIENTS_PER_REQUEST,
  addMeetingRecipients,
  listMeetingRecipients,
  removeMeetingRecipient,
} from "./meeting-recipients";

export interface RecipientManagerAccess {
  meetingId: string;
  meetingTitle: string;
  userId: string;
  userEmail: string;
  userName: string;
}

export interface RecipientsAddedEvent {
  meetingId: string;
  meetingTitle: string;
  sharedBy: { name: string; email: string };
  emails: string[];
}

const noStore = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

export async function handleMeetingRecipientsRequest(
  request: Request,
  deps: {
    db: Db;
    access: RecipientManagerAccess | null;
    /** Fire-and-forget notification hook; must never throw into the response. */
    onRecipientsAdded?: (event: RecipientsAddedEvent) => void;
  },
): Promise<Response> {
  const { db, access } = deps;
  if (!access) return json({ error: "Meeting not found" }, 404);

  const limits = {
    perRequest: MAX_RECIPIENTS_PER_REQUEST,
    perMeeting: MAX_RECIPIENTS_PER_MEETING,
  };

  if (request.method === "GET") {
    return json({ recipients: await listMeetingRecipients(db, access.meetingId), limits });
  }

  if (request.method === "POST") {
    // Transcript visibility is the meeting-level setting (POST .../share
    // { includeTranscript }); a per-person value is ignored if sent.
    let body: { emails?: unknown };
    try {
      body = (await request.json()) as typeof body;
      if (!body || typeof body !== "object") throw new Error("invalid_body");
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const result = await addMeetingRecipients(db, {
      meetingId: access.meetingId,
      sharedByUserId: access.userId,
      sharedByEmail: access.userEmail,
      emails: body.emails,
    });
    if (!result.ok) {
      return json(
        { error: result.error, code: result.code, ...(result.emails ? { emails: result.emails } : {}) },
        result.status,
      );
    }
    try {
      deps.onRecipientsAdded?.({
        meetingId: access.meetingId,
        meetingTitle: access.meetingTitle,
        sharedBy: { name: access.userName, email: access.userEmail },
        emails: result.added.map((recipient) => recipient.email),
      });
    } catch (error) {
      console.error("[share] Could not schedule share notifications", error);
    }
    return json(
      {
        ok: true,
        added: result.added,
        recipients: await listMeetingRecipients(db, access.meetingId),
        limits,
      },
      201,
    );
  }

  if (request.method === "DELETE") {
    let recipientId = new URL(request.url).searchParams.get("recipientId");
    if (!recipientId) {
      try {
        const body = (await request.json()) as { recipientId?: unknown };
        recipientId = typeof body?.recipientId === "string" ? body.recipientId : null;
      } catch {
        recipientId = null;
      }
    }
    if (!recipientId) return json({ error: "recipientId is required" }, 400);
    const removed = await removeMeetingRecipient(db, {
      meetingId: access.meetingId,
      recipientId,
    });
    if (!removed) return json({ error: "Recipient not found" }, 404);
    return json({ ok: true, recipients: await listMeetingRecipients(db, access.meetingId), limits });
  }

  return json({ error: "Method not allowed" }, 405);
}
