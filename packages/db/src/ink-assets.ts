import { sql } from "drizzle-orm";
import type { Db } from "./client";
export const INK_MAX_BYTES = 3 * 1024 * 1024;
export const INK_TYPES = {
  ink: "application/x-apple-pencilkit",
  preview: "image/png",
} as const;
export type InkPart = keyof typeof INK_TYPES;
export interface InkManifest {
  libraryId: string;
  noteId: string;
  attachmentId: string;
  versionId: string;
  generation: string;
  expectedRevision: string;
  ink: { size: number; sha256: string; contentType: string };
  preview: { size: number; sha256: string; contentType: string };
}
export function inkId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new Error("invalid_id");
}
export function validateInkManifest(value: unknown): InkManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_manifest");
  const m = value as Record<string, unknown>;
  const ids = [
    "libraryId",
    "noteId",
    "attachmentId",
    "versionId",
    "generation",
    "expectedRevision",
  ];
  if (Object.keys(m).some((k) => ![...ids, "ink", "preview"].includes(k)))
    throw new Error("invalid_manifest");
  ids.forEach((k) => inkId(m[k]));
  for (const part of ["ink", "preview"] as const) {
    const d = m[part] as InkManifest["ink"];
    if (
      !d ||
      typeof d !== "object" ||
      Object.keys(d).some(
        (k) => !["size", "sha256", "contentType"].includes(k),
      ) ||
      !Number.isInteger(d.size) ||
      d.size < 1 ||
      d.size > INK_MAX_BYTES ||
      d.contentType !== INK_TYPES[part] ||
      typeof d.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(d.sha256)
    )
      throw new Error("invalid_manifest");
  }
  return m as unknown as InkManifest;
}
export function inkRows(r: unknown): Array<Record<string, unknown>> {
  return Array.isArray(r)
    ? r
    : (r as { rows: Array<Record<string, unknown>> }).rows;
}
export async function reserveInk(
  db: Db,
  org: string,
  value: unknown,
): Promise<string> {
  const m = validateInkManifest(value);
  return String(
    inkRows(
      await db.execute(
        sql`select ink_reserve(${org},${JSON.stringify(m)}::jsonb) as status`,
      ),
    )[0]!.status,
  );
}
export async function uploadMetadata(db: Db, org: string, version: string) {
  inkId(version);
  const row = inkRows(
    await db.execute(sql`select v.manifest,v.state from ink_versions v join sync_notes n on n.id=v.note_id
 where v.id=${version}::uuid and v.organization_id=${org} and n.organization_id=${org} and n.state='active' and n.lifecycle_generation=v.generation
 and (v.state='ready' or v.created_at>now()-interval '24 hours')`),
  )[0];
  return row
    ? { manifest: row.manifest as InkManifest, state: String(row.state) }
    : null;
}
export async function markInkUploaded(
  db: Db,
  org: string,
  version: string,
  part: InkPart,
) {
  return String(
    inkRows(
      await db.execute(
        sql`select ink_uploaded(${org},${version}::uuid,${part}) as status`,
      ),
    )[0]!.status,
  );
}
export async function downloadMetadata(
  db: Db,
  org: string,
  library: string,
  note: string,
  revision: string,
  version: string,
) {
  [library, note, revision, version].forEach(inkId);
  const row = inkRows(
    await db.execute(sql`select v.manifest from ink_versions v join sync_notes n on n.id=v.note_id join sync_revisions r on r.note_id=n.id
 where v.id=${version}::uuid and v.organization_id=${org} and n.organization_id=${org} and n.library_id=${library}::uuid and n.id=${note}::uuid
 and r.id=${revision}::uuid and r.organization_id=${org} and v.state='ready' and n.state<>'purged' and (n.state<>'trashed' or n.expires_at>now())
 and r.snapshot->'inkAttachments' @> jsonb_build_array(jsonb_build_object('id',v.attachment_id,'versionId',v.id))`),
  )[0];
  return row ? (row.manifest as InkManifest) : null;
}
