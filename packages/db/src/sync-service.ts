import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { validateSyncOperation, canonical } from './sync-contract';

function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result) ? result : (result as {rows:Array<Record<string,unknown>>}).rows;
}
export async function applySync(db: Db, organizationId: string, value: unknown) {
  const operation=validateSyncOperation(value);
  const serialized=canonical(operation);
  const hash=createHash('sha256').update(serialized).digest('hex');
  const result=await db.execute(sql`select sync_apply(${organizationId},${serialized}::jsonb,${hash}) as receipt`);
  return rows(result)[0]!.receipt;
}
export async function writeLegacy(db: Db, organizationId:string, item: unknown) {
  await db.execute(sql`select sync_legacy_write(${organizationId},${JSON.stringify(item)}::jsonb)`);
}
/** Cursor ownership checked against authenticated org+library; no client tenant selection. */
export async function pullSync(db: Db, organizationId:string, libraryId:string, after='0', limit=20) {
  if(!/^[0-9a-f-]{36}$/i.test(libraryId)||!/^\d{1,16}$/.test(after)||!Number.isSafeInteger(Number(after))||limit<1||limit>50)throw new Error('invalid_cursor');
  const library=rows(await db.execute(sql`select id from sync_libraries where id=${libraryId}::uuid and organization_id=${organizationId}`));
  if(!library.length)throw new Error('not_found');
  await db.execute(sql`select sync_expire(${organizationId},${libraryId}::uuid)`);
  const result=rows(await db.execute(sql`select r.id,r.note_id,r.parent_id,r.sequence::text,r.kind,r.created_at,
      case when n.state='purged' or (n.state='trashed' and n.expires_at<=clock_timestamp()) then null else r.snapshot end as snapshot,
      n.head_revision,n.lifecycle_generation,
      n.state,
      n.deletion_id,n.deleted_at,n.expires_at
    from sync_revisions r join sync_notes n on n.id=r.note_id
    where r.organization_id=${organizationId} and n.organization_id=${organizationId} and n.library_id=${libraryId}::uuid and r.sequence>${after}::bigint
    order by r.sequence limit ${limit+1}`));
  const page=result.slice(0,limit);
  return {changes:page,hasMore:result.length>limit,after:page.length?String(page.at(-1)!.sequence):after};
}
