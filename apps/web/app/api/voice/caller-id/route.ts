import { NextResponse } from "next/server";

import { and, eq, getDb, ne, verifiedCallerIds } from "@repo/db";

import { authenticateEntitledSyncRequest, authenticateSyncRequest } from "@/lib/sync-auth";
import {
  createValidationRequest,
  deleteOutgoingCallerId,
  findVerifiedCallerId,
  twilioConfig,
} from "@/lib/twilio";

const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Verified Caller ID: let a user's outbound DoodleNote calls display their
 * own number. POST starts Twilio's validation call (returns the 6-digit code
 * to display), GET reports status (confirming with Twilio while pending),
 * DELETE clears the stored number.
 */
export async function POST(request: Request) {
  const authed = await authenticateEntitledSyncRequest(request);
  if (authed.response) return authed.response;
  const device = authed.device;
  const config = twilioConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Phone calls are not enabled on this server yet" },
      { status: 503 },
    );
  }

  let phoneNumber: string;
  try {
    const body = (await request.json()) as { phoneNumber?: string };
    phoneNumber = (body.phoneNumber ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!E164.test(phoneNumber)) {
    return NextResponse.json(
      { error: "Enter the number in international format, e.g. +16145551234" },
      { status: 400 },
    );
  }

  const db = getDb();

  // The Twilio account is shared, so "verified on Twilio" does not mean
  // "verified by THIS user". A number may only be reused if this user's own row
  // already holds it; one claimed by another user is refused, and an orphan
  // (no row owns it) is removed so its keypad code has to be entered again.
  if (await claimedByAnotherUser(db, device.userId, phoneNumber)) {
    return NextResponse.json(
      { error: "That number is already linked to another DoodleNote account" },
      { status: 409 },
    );
  }
  const existingSid = await findVerifiedCallerId(config, phoneNumber);
  if (existingSid) {
    const [mine] = await db
      .select()
      .from(verifiedCallerIds)
      .where(eq(verifiedCallerIds.userId, device.userId))
      .limit(1);
    if (mine?.phoneNumber === phoneNumber && mine.outgoingCallerIdSid === existingSid) {
      await upsert(db, device.userId, phoneNumber, "verified", existingSid);
      return NextResponse.json({ status: "verified", phoneNumber });
    }
    if (!(await deleteOutgoingCallerId(config, existingSid))) {
      return NextResponse.json({ error: "Verification failed" }, { status: 502 });
    }
  }

  try {
    const { validationCode } = await createValidationRequest(
      config,
      phoneNumber,
      `DoodleNote ${device.userId}`,
    );
    await upsert(db, device.userId, phoneNumber, "pending", null);
    return NextResponse.json({ status: "pending", phoneNumber, validationCode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verification failed" },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(verifiedCallerIds)
    .where(eq(verifiedCallerIds.userId, device.userId))
    .limit(1);
  if (!row) {
    return NextResponse.json({ status: "none" });
  }

  // Pending rows re-check Twilio: verification completes out-of-band when
  // the user enters the code on the validation call.
  if (row.status === "pending") {
    const config = twilioConfig();
    const sid = config
      ? await findVerifiedCallerId(config, row.phoneNumber)
      : null;
    if (sid && !(await claimedByAnotherUser(db, device.userId, row.phoneNumber))) {
      await upsert(db, device.userId, row.phoneNumber, "verified", sid);
      return NextResponse.json({ status: "verified", phoneNumber: row.phoneNumber });
    }
  }
  return NextResponse.json({ status: row.status, phoneNumber: row.phoneNumber });
}

export async function DELETE(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(verifiedCallerIds)
    .where(eq(verifiedCallerIds.userId, device.userId))
    .limit(1);
  // Also release the number on Twilio, or the next account to submit it would
  // inherit the verification without proving it controls the phone.
  const config = twilioConfig();
  if (config && row?.outgoingCallerIdSid) {
    await deleteOutgoingCallerId(config, row.outgoingCallerIdSid).catch(() => false);
  }
  await db
    .delete(verifiedCallerIds)
    .where(eq(verifiedCallerIds.userId, device.userId));
  return NextResponse.json({ ok: true });
}

type Db = ReturnType<typeof getDb>;

async function claimedByAnotherUser(db: Db, userId: string, phoneNumber: string): Promise<boolean> {
  const rows = await db
    .select({ userId: verifiedCallerIds.userId })
    .from(verifiedCallerIds)
    .where(
      and(
        eq(verifiedCallerIds.phoneNumber, phoneNumber),
        eq(verifiedCallerIds.status, "verified"),
        ne(verifiedCallerIds.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function upsert(
  db: Db,
  userId: string,
  phoneNumber: string,
  status: string,
  sid: string | null,
) {
  await db
    .insert(verifiedCallerIds)
    .values({
      userId,
      phoneNumber,
      status,
      outgoingCallerIdSid: sid,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: verifiedCallerIds.userId,
      set: {
        phoneNumber,
        status,
        outgoingCallerIdSid: sid,
        updatedAt: new Date(),
      },
    });
}
