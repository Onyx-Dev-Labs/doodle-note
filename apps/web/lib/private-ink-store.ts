import { get, put, del } from "@vercel/blob";
import { INK_MAX_BYTES, type InkPart } from "@repo/db";
export interface PrivateInkStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<void>;
}
export function privateInkEnabled() {
  return process.env.DOODLENOTE_PRIVATE_INK_ENABLED === "true";
}
export function inkPath(version: string, part: InkPart) {
  return `private-ink/${version}/${part}`;
}
export async function boundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  max = INK_MAX_BYTES,
): Promise<Uint8Array> {
  if (!stream) throw new Error("empty_body");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error("too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
/** Dedicated credential only. Never fall back to the legacy public attachment store. */
export function privateInkStore(): PrivateInkStore {
  const token = process.env.DOODLENOTE_PRIVATE_INK_TOKEN;
  if (!token) throw new Error("private_store_unconfigured");
  return createPrivateInkStore(token);
}
export function createPrivateInkStore(
  token: string,
  sdk: Pick<typeof import("@vercel/blob"), "put" | "get" | "del"> = {
    put,
    get,
    del,
  },
): PrivateInkStore {
  if (!token) throw new Error("private_store_unconfigured");
  const options = () => ({ token, abortSignal: AbortSignal.timeout(10000) });
  return {
    async put(path, bytes, contentType) {
      const blob = await sdk.put(path, Buffer.from(bytes), {
        ...options(),
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      if (
        new URL(blob.url).hostname.endsWith(
          ".private.blob.vercel-storage.com",
        ) !== true
      )
        throw new Error("private_store_required");
    },
    async get(path) {
      const result = await sdk.get(path, {
        ...options(),
        access: "private",
        useCache: false,
      });
      if (!result) return null;
      if (
        result.statusCode !== 200 ||
        !new URL(result.blob.url).hostname.endsWith(
          ".private.blob.vercel-storage.com",
        )
      ) {
        await result.stream?.cancel();
        throw new Error("private_store_required");
      }
      return boundedBytes(result.stream);
    },
    async delete(path) {
      await sdk.del(path, options());
    },
  };
}
