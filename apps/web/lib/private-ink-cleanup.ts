import { getDb, sql, inkRows, type Db } from "@repo/db";
import { privateInkStore, type PrivateInkStore } from "./private-ink-store";
/** Installed-schema detection also protects cleanup during flag-off rollback. */
export async function cleanupPrivateInk(
  db: Db = getDb(),
  org?: string,
  provider?: PrivateInkStore,
  maxMilliseconds = 20000,
) {
  if (maxMilliseconds < 10000)
    return { deleted: 0, failed: 0, pending: 0, deferred: true };
  const deadline = Date.now() + maxMilliseconds;
  const installed = inkRows(
    await db.execute(
      sql`select to_regprocedure('ink_collect(text)') is not null as available`,
    ),
  )[0]?.available;
  if (!installed) return { deleted: 0, failed: 0, pending: 0 };
  const workspaces = org
    ? [org]
    : inkRows(
        await db.execute(sql`select organization_id from (
    select v.organization_id from ink_versions v where v.created_at<now()-interval '24 hours'
    and not exists(select 1 from sync_revisions r where r.note_id=v.note_id and r.snapshot->'inkAttachments' @> jsonb_build_array(jsonb_build_object('id',v.attachment_id,'versionId',v.id)))
    union select organization_id from sync_notes where state='trashed' and expires_at<=now()
  ) candidates order by organization_id limit 50`),
      ).map((row) => String(row.organization_id));
  for (const workspace of workspaces) {
    if (Date.now() + 10000 > deadline) break;
    await db.execute(sql`select ink_collect(${workspace})`);
  }
  const work = inkRows(
    await db.execute(
      sql`select path from ink_cleanup where (${org ?? null}::text is null or organization_id=${org ?? null}) and next_attempt_at<=now() order by (deleted_at is not null),next_attempt_at limit 100`,
    ),
  );
  let deleted = 0,
    failed = 0;
  // No private credential dependency for accounts with no private objects.
  if (work.length) {
    let store: PrivateInkStore;
    try {
      store = provider ?? privateInkStore();
    } catch {
      return { deleted: 0, failed: work.length, pending: work.length };
    }
    for (const row of work) {
      if (Date.now() + 10000 > deadline) break;
      const path = String(row.path);
      try {
        await store.delete(path);
        deleted++;
        // Retain minimal tombstones and re-delete daily: covers a provider upload
        // completing after its aborted request and the first cleanup attempt.
        await db.execute(
          sql`update ink_cleanup set deleted_at=now(),attempts=attempts+1,next_attempt_at=now()+interval '1 day' where path=${path}`,
        );
      } catch {
        failed++;
        await db.execute(
          sql`update ink_cleanup set attempts=attempts+1,next_attempt_at=now()+interval '1 hour' where path=${path}`,
        );
      }
    }
  }
  const pending = Number(
    inkRows(
      await db.execute(
        sql`select count(*) as count from ink_cleanup where deleted_at is null and (${org ?? null}::text is null or organization_id=${org ?? null})`,
      ),
    )[0]?.count ?? 0,
  );
  return { deleted, failed, pending };
}
