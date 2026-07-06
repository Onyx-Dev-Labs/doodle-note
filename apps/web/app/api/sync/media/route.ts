import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

import { authenticateSyncRequest } from "@/lib/sync-auth";

/** Keeps the JSON body under Vercel's request limit (base64 ≈ 4/3 size). */
const MAX_BYTES = 3 * 1024 * 1024;

const NAME_RE = /^[a-z0-9-]+\.(png|jpg|jpeg|gif|webp)$/;
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Upload one note attachment. Bearer-authenticated; images land in the
 * public Blob store under the workspace's prefix and the desktop rewrites
 * its markdown to the returned URL when pushing.
 */
export async function POST(request: Request) {
  const device = await authenticateSyncRequest(request);
  if (!device) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }

  let body: { name?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = String(body.name ?? "");
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: "Bad attachment name" }, { status: 400 });
  }
  const ext = name.split(".").pop()!;
  const data = typeof body.data === "string" ? body.data : "";
  const buffer = Buffer.from(data, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: `Attachment must be 1 byte – ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 400 },
    );
  }

  try {
    const blob = await put(
      `attachments/${device.organizationId}/${name}`,
      buffer,
      {
        access: "public",
        contentType: MIME_BY_EXT[ext],
        addRandomSuffix: false,
      },
    );
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}
