import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { inkId, inkRows } from './ink-assets';
import { canonical } from './sync-contract';

export async function legacySyncAvailable(db: Db) {
  return Boolean(inkRows(await db.execute(sql`select to_regprocedure('sync_adopt_legacy(text,jsonb,text)') is not null as available`))[0]?.available);
}
export async function discoverLegacy(db: Db, org: string, after?: string) {
  if (after) inkId(after);
  const rows = inkRows(await db.execute(sql`select m.id,m.title,m.created_at,
    (select count(*)::int from transcript_segments t where t.meeting_id=m.id) as transcript_count
    from meetings m where m.organization_id=${org}
    and not exists(select 1 from sync_notes n where n.id=m.id)
    and (${after ?? null}::uuid is null or m.id>${after ?? null}::uuid)
    order by m.id limit 51`));
  const count = inkRows(await db.execute(sql`select count(*)::int as total from meetings m where m.organization_id=${org}
    and not exists(select 1 from sync_notes n where n.id=m.id)`))[0]?.total ?? 0;
  return {notes: rows.slice(0,50), total: count, next: rows.length>50 ? String(rows[49]!.id) : null};
}
export async function adoptLegacy(db: Db, org: string, value: unknown) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('invalid_adoption');
  const row=value as Record<string,unknown>;
  if (Object.keys(row).length!==3 || Object.keys(row).some(k=>!['libraryId','noteId','operationId'].includes(k))) throw new Error('invalid_adoption');
  for(const key of ['libraryId','noteId','operationId']) inkId(row[key]);
  const serialized=canonical(row), hash=createHash('sha256').update(serialized).digest('hex');
  return inkRows(await db.execute(sql`select sync_adopt_legacy(${org},${serialized}::jsonb,${hash}) as receipt`))[0]!.receipt;
}
