import { sql, type Db } from "@repo/db";
import type { SyncDeviceAuth } from "./sync-auth";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization" };

/** Identity comes only from the authenticated device, never request fields. */
export async function syncAccountResponse(
  db: Db,
  device: SyncDeviceAuth,
  entitled: boolean,
  enabled: boolean,
): Promise<Response> {
  let available = false;
  let libraries: Array<{ id: string }> = [];
  if (enabled) {
    const schema = await db.execute(sql`select to_regclass('public.sync_libraries') is not null as installed`);
    if (schema.rows[0]?.installed === true) {
      available = true;
      const result = await db.execute(sql`select id from sync_libraries
        where organization_id=${device.organizationId} order by id`);
      libraries = result.rows.map((row) => ({ id: String(row.id) }));
    }
  }
  return Response.json({
    accountId: device.userId,
    workspaceId: device.organizationId,
    workspaceName: device.organizationName,
    entitled,
    syncAvailable: available,
    libraries,
  }, { headers: privateHeaders });
}
