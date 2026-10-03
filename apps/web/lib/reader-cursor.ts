import { createHmac, timingSafeEqual } from "node:crypto";
function key() {
  const value = process.env.DOODLENOTE_SYNC_CURSOR_SECRET;
  if (!value || value.length < 32) throw new Error("reader_configuration");
  return value;
}
export function encodeReaderCursor(
  org: string,
  note: string | undefined,
  after: string,
) {
  const data = Buffer.from(
    JSON.stringify({ v: 1, org, scope: note ?? "list", after }),
  ).toString("base64url");
  return (
    data + "." + createHmac("sha256", key()).update(data).digest("base64url")
  );
}
export function decodeReaderCursor(
  org: string,
  note: string | undefined,
  cursor: string,
) {
  if (cursor.length > 1000) throw new Error("invalid_cursor");
  const [data, signature, ...extra] = cursor.split(".");
  const expected = createHmac("sha256", key()).update(data).digest(),
    actual = Buffer.from(signature ?? "", "base64url");
  if (
    extra.length ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new Error("invalid_cursor");
  const value = JSON.parse(Buffer.from(data, "base64url").toString());
  if (
    value.v !== 1 ||
    value.org !== org ||
    value.scope !== (note ?? "list") ||
    typeof value.after !== "string"
  )
    throw new Error("invalid_cursor");
  return value.after as string;
}
