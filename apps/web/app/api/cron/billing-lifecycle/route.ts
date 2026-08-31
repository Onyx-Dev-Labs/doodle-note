import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  processDueDataDeletions,
  processPendingBillingNotifications,
} from "@/lib/billing-lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Hourly safety worker. Stripe's terminal webhook normally performs the purge
 * immediately; this route retries durable jobs and emails after transient
 * provider failures without trusting the browser or a customer session.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Billing lifecycle worker is not configured" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deletions = await processDueDataDeletions();
  const notifications = await processPendingBillingNotifications();
  return NextResponse.json({ ok: true, deletions, notifications });
}
