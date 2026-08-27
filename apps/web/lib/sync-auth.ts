import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { eq, getDb, organization, syncDevices } from "@repo/db";

import { entitlementFor } from "@/lib/billing";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(): string {
  return `dnsy_${randomBytes(32).toString("hex")}`;
}

export interface SyncDeviceAuth {
  deviceId: string;
  userId: string;
  organizationId: string;
  organizationName: string;
}

/**
 * Resolves the `Authorization: Bearer <sync token>` header to a linked
 * device, or null. Only the token's SHA-256 is stored, so lookup is by hash.
 */
export async function authenticateSyncRequest(
  request: Request,
): Promise<SyncDeviceAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("dnsy_") || token.length < 40) return null;

  const db = getDb();
  const rows = await db
    .select({
      deviceId: syncDevices.id,
      userId: syncDevices.userId,
      organizationId: syncDevices.organizationId,
      organizationName: organization.name,
    })
    .from(syncDevices)
    .innerJoin(organization, eq(organization.id, syncDevices.organizationId))
    .where(eq(syncDevices.tokenHash, hashToken(token)))
    .limit(1);
  const device = rows[0];
  if (!device) return null;

  // Best-effort liveness stamp; never block the request on it.
  db.update(syncDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(syncDevices.id, device.deviceId))
    .catch(() => {});

  return device;
}

/**
 * Device auth + billing in one step for data-moving sync routes. Returns
 * the device, or a ready-made 402 when the owner's subscription lapsed —
 * the desktop surfaces the message verbatim. (/api/sync/ping stays
 * ungated so clients can tell "no network" from "needs subscription".)
 */
export async function authenticateEntitledSyncRequest(
  request: Request,
): Promise<
  | { device: SyncDeviceAuth; response?: undefined }
  | { device?: undefined; response: Response }
> {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return {
      response: NextResponse.json({ error: "Invalid sync token" }, { status: 401 }),
    };
  }
  const entitlement = await entitlementFor(device.userId);
  if (!entitlement.entitled) {
    if (entitlement.reason === "configuration_error") {
      return {
        response: NextResponse.json(
          { error: "Cloud sync is unavailable because billing is not configured" },
          { status: 503 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        {
          error:
            "Cloud sync needs an active subscription — manage billing at https://www.doodlenote.ai/pricing",
          needsSubscription: true,
        },
        { status: 402 },
      ),
    };
  }
  return { device };
}
