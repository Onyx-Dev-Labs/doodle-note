import { validateInkPreview } from "./ink-preview";
import { createHash } from "node:crypto";
import {
  type Db,
  INK_TYPES,
  inkId,
  reserveInk,
  uploadMetadata,
  markInkUploaded,
  downloadMetadata,
  type InkPart,
  type InkManifest,
} from "@repo/db";
import {
  boundedBytes,
  inkPath,
  type PrivateInkStore,
} from "./private-ink-store";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}
function valid(bytes: Uint8Array, manifest: InkManifest, part: InkPart) {
  const d = manifest[part];
  if (
    bytes.byteLength !== d.size ||
    createHash("sha256").update(bytes).digest("hex") !== d.sha256
  )
    throw new Error("invalid_content");
  // PencilKit's versioned serialization is opaque server-side. Only PNG previews
  // are rendered; ink bytes are downloaded as an attachment by native clients.
  if (part === "preview") validateInkPreview(bytes);
}
export async function handlePrivateInk(
  request: Request,
  db: Db,
  org: string,
  store: PrivateInkStore,
): Promise<Response> {
  try {
    if (request.method === "POST") {
      const bytes = await boundedBytes(request.body, 4096);
      let value: unknown;
      try {
        value = JSON.parse(Buffer.from(bytes).toString("utf8"));
      } catch {
        return json({ error: "invalid_manifest" }, 400);
      }
      const status = await reserveInk(db, org, value);
      return json(
        { status },
        ["pending", "ready"].includes(status)
          ? 200
          : status === "not_found"
            ? 404
            : 409,
      );
    }
    const q = new URL(request.url).searchParams;
    const version = q.get("versionId");
    inkId(version);
    const part = q.get("part");
    if (part !== "ink" && part !== "preview")
      return json({ error: "invalid_part" }, 400);
    if (request.method === "PUT") {
      const metadata = await uploadMetadata(db, org, version);
      if (!metadata) return json({ error: "not_found" }, 404);
      if (request.headers.get("content-type") !== INK_TYPES[part])
        return json({ error: "invalid_content_type" }, 400);
      const bytes = await boundedBytes(request.body);
      valid(bytes, metadata.manifest, part);
      // Immutable deterministic object path. A lost reply or concurrent upload may
      // report "exists"; only a hash-verified private read makes that a safe retry.
      try {
        await store.put(inkPath(version, part), bytes, INK_TYPES[part]);
      } catch {
        const existing = await store.get(inkPath(version, part));
        if (!existing) throw new Error("storage_unavailable");
        valid(existing, metadata.manifest, part);
      }
      const status = await markInkUploaded(db, org, version, part);
      return json(
        { status },
        ["pending", "ready"].includes(status) ? 200 : 409,
      );
    }
    if (request.method === "GET") {
      const library = q.get("libraryId"),
        note = q.get("noteId"),
        revision = q.get("revisionId");
      [library, note, revision].forEach(inkId);
      const metadata = await downloadMetadata(
        db,
        org,
        library!,
        note!,
        revision!,
        version,
      );
      if (!metadata) return json({ error: "not_found" }, 404);
      const bytes = await store.get(inkPath(version, part));
      if (!bytes) return json({ error: "temporarily_unavailable" }, 503);
      valid(bytes, metadata, part);
      // Revalidate after I/O: purge/expiry must not serve a fetched blob.
      if (
        !(await downloadMetadata(db, org, library!, note!, revision!, version))
      )
        return json({ error: "not_found" }, 404);
      return new Response(Buffer.from(bytes), {
        headers: {
          ...headers,
          "Content-Type": INK_TYPES[part],
          "Content-Length": String(bytes.length),
          "Content-Disposition": `attachment; filename="note.${part === "ink" ? "drawing" : "png"}"`,
        },
      });
    }
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json(
      {
        error: [
          "invalid_id",
          "invalid_manifest",
          "invalid_content",
          "too_large",
          "empty_body",
        ].includes(code)
          ? code
          : "temporarily_unavailable",
      },
      [
        "invalid_id",
        "invalid_manifest",
        "invalid_content",
        "too_large",
        "empty_body",
      ].includes(code)
        ? 400
        : 503,
    );
  }
}
