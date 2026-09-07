import { decodeReaderCursor, encodeReaderCursor } from "./reader-cursor";
import {
  getDb,
  readerAvailable,
  listReaderNotes,
  readerDetail,
  readerAction,
  type Db,
} from "@repo/db";
import { handlePrivateInk } from "./private-ink";
import { privateInkEnabled, privateInkStore } from "./private-ink-store";
import { readBoundedJSON, syncV2Enabled } from "./sync-v2";
export const readerHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie",
  "X-Content-Type-Options": "nosniff",
};
export const readerError = (status: number, error: string) =>
  Response.json({ error }, { status, headers: readerHeaders });
export async function handleMobileReader(
  request: Request,
  organizationId: string,
  db: Db = getDb(),
) {
  if (!syncV2Enabled()) return readerError(404, "reader_unavailable");
  try {
    encodeReaderCursor(organizationId, undefined, "0");
    if (!(await readerAvailable(db)))
      return readerError(503, "reader_unavailable");
    const q = new URL(request.url).searchParams;
    if (request.method === "GET" && q.get("mode") === "preview") {
      if (!privateInkEnabled()) return readerError(503, "preview_unavailable");
      if (q.get("part") !== "preview")
        return readerError(400, "invalid_request");
      const response = await handlePrivateInk(
        request,
        db,
        organizationId,
        privateInkStore(),
      );
      for (const [key, value] of Object.entries(readerHeaders))
        response.headers.set(key, value);
      return response;
    }
    if (request.method === "POST")
      return Response.json(
        await readerAction(db, organizationId, await readBoundedJSON(request)),
        { headers: readerHeaders },
      );
    if (request.method !== "GET") return readerError(405, "invalid_method");
    const after = q.get("after")
      ? decodeReaderCursor(
          organizationId,
          q.get("noteId") ?? undefined,
          q.get("after")!,
        )
      : undefined;
    const result = q.has("noteId")
      ? await readerDetail(
          db,
          organizationId,
          q.get("noteId")!,
          q.get("revisionId") ?? undefined,
          after,
        )
      : await listReaderNotes(db, organizationId, after);
    if (result?.next)
      result.next = encodeReaderCursor(
        organizationId,
        q.get("noteId") ?? undefined,
        result.next,
      );
    return result
      ? Response.json(result, { headers: readerHeaders })
      : readerError(404, "note_unavailable");
  } catch (error) {
    const invalid =
      error instanceof Error &&
      [
        "invalid_action",
        "invalid_id",
        "invalid_cursor",
        "invalid_body",
        "payload_limit",
      ].includes(error.message);
    return readerError(
      invalid ? 400 : 503,
      invalid ? "request_rejected" : "reader_unavailable",
    );
  }
}
