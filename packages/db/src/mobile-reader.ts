import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { inkId, inkRows } from "./ink-assets";
import { canonical, validateSyncOperation } from "./sync-contract";
import { applySync } from "./sync-service";
export async function readerAvailable(db: Db) {
  return Boolean(
    inkRows(
      await db.execute(
        sql`select to_regprocedure('sync_choose_revision(text,jsonb,text)') is not null as available`,
      ),
    )[0]?.available,
  );
}
function note(row: Record<string, unknown>) {
  return {
    id: row.id,
    libraryId: row.library_id,
    title: row.title ?? "Untitled note",
    state: row.state,
    headRevision: row.head_revision,
    contentRevision: row.content_revision,
    generation: row.lifecycle_generation,
    deletionId: row.deletion_id,
    expiresAt: row.expires_at,
  };
}
export async function listReaderNotes(db: Db, org: string, after?: string) {
  if (after) inkId(after);
  const rows = inkRows(
    await db.execute(sql`select n.*,h.id as content_revision,h.snapshot->>'title' as title from sync_notes n
 left join lateral sync_reader_head(n.id) h on true
 where n.organization_id=${org} and n.state<>'purged' and (n.state<>'trashed' or n.expires_at>now())
 and (${after ?? null}::uuid is null or n.id>${after ?? null}::uuid) order by n.id limit 51`),
  );
  return {
    notes: rows.slice(0, 50).map(note),
    next: rows.length > 50 ? String(rows[49]!.id) : null,
  };
}
export async function readerDetail(
  db: Db,
  org: string,
  id: string,
  revision?: string,
  after?: string,
) {
  inkId(id);
  if (revision) inkId(revision);
  if (after && !/^\d{1,16}$/.test(after)) throw new Error("invalid_cursor");
  const n = inkRows(
    await db.execute(
      sql`select n.*,h.id as content_revision,h.snapshot->>'title' as title from sync_notes n left join lateral sync_reader_head(n.id) h on true where n.id=${id}::uuid and n.organization_id=${org}`,
    ),
  )[0];
  if (
    !n ||
    n.state === "purged" ||
    (n.state === "trashed" &&
      new Date(String(n.expires_at)).getTime() <= Date.now())
  )
    return null;
  const versions = inkRows(
    await db.execute(
      sql`select id,kind,created_at,sequence from sync_revisions where note_id=${id}::uuid and organization_id=${org} and snapshot is not null and (${after ?? null}::bigint is null or sequence<${after ?? null}::bigint) order by sequence desc limit 51`,
    ),
  );
  const selected = inkRows(
    await db.execute(
      sql`select id,snapshot from sync_revisions where note_id=${id}::uuid and organization_id=${org} and snapshot is not null and id=${revision ?? n.content_revision ?? null}::uuid limit 1`,
    ),
  )[0];
  if (revision && !selected) return null;
  const stillCurrent = inkRows(
    await db.execute(sql`select id from sync_notes where id=${id}::uuid and organization_id=${org}
    and state=${n.state} and lifecycle_generation=${n.lifecycle_generation}::uuid
    and head_revision is not distinct from ${n.head_revision}::uuid
    and state<>'purged' and (state<>'trashed' or expires_at>now())`),
  );
  if (!stillCurrent.length) return null;
  return {
    note: {
      ...note(n),
      title:
        (selected?.snapshot as { title?: string })?.title ??
        n.title ??
        "Untitled note",
    },
    versions: versions
      .slice(0, 50)
      .map((v) => ({ id: v.id, kind: v.kind, createdAt: v.created_at })),
    next: versions.length > 50 ? String(versions[49]!.sequence) : null,
    selectedRevision: selected?.id ?? null,
    snapshot: selected?.snapshot ?? null,
  };
}
export async function readerAction(db: Db, org: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_action");
  const a = value as Record<string, unknown>;
  if (
    Object.keys(a).some(
      (k) =>
        ![
          "kind",
          "libraryId",
          "noteId",
          "operationId",
          "expectedRevision",
          "expectedLifecycleGeneration",
          "selectedRevision",
          "deletionId",
        ].includes(k),
    )
  )
    throw new Error("invalid_action");
  for (const key of [
    "libraryId",
    "noteId",
    "operationId",
    "expectedRevision",
    "expectedLifecycleGeneration",
  ])
    inkId(a[key]);
  if (a.kind === "choose") {
    inkId(a.selectedRevision);
    if (a.deletionId) throw new Error("invalid_action");
    const serialized = canonical(a);
    const hash = createHash("sha256").update(serialized).digest("hex");
    return inkRows(
      await db.execute(
        sql`select sync_choose_revision(${org},${serialized}::jsonb,${hash}) as receipt`,
      ),
    )[0]!.receipt;
  }
  if (
    !["trash", "restore", "purge"].includes(String(a.kind)) ||
    a.selectedRevision
  )
    throw new Error("invalid_action");
  return applySync(
    db,
    org,
    validateSyncOperation({ ...a, protocolVersion: 2 }),
  );
}
