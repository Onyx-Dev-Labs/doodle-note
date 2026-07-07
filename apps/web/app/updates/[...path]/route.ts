import { NextResponse } from "next/server";

/**
 * Update-feed proxy: serves latest*.yml manifests and installer artifacts
 * from the Blob store THROUGH the app's own domain. Born from an outage:
 * Vercel's platform bot-mitigation challenged the raw
 * *.public.blob.vercel-storage.com domain (403 "Security Checkpoint"),
 * which electron-updater can never pass — bricking OTA updates and the
 * landing-page downloads. Server-to-server fetches from this function
 * aren't subject to the browser challenge, and this project's domain is
 * governed by our own (empty) firewall config.
 */

const BLOB_BASE =
  "https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates";

/** Installer/manifest names only — no traversal, no query games. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;

export const maxDuration = 300; // installers are ~160MB; stream, don't rush

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const parts = (await params).path ?? [];
  const name = parts.join("/");
  if (parts.length !== 1 || !SAFE_NAME.test(name)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const upstream = await fetch(`${BLOB_BASE}/${encodeURIComponent(name)}`, {
    redirect: "follow",
    // Manifests must be fresh; Next's fetch cache would defeat the 60s TTL.
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Upstream ${upstream.status}` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const isManifest = name.endsWith(".yml");
  const headers = new Headers({
    "content-type":
      upstream.headers.get("content-type") ?? "application/octet-stream",
    // Versioned artifacts are immutable; manifests revalidate fast.
    "cache-control": isManifest
      ? "public, max-age=60"
      : "public, max-age=31536000, immutable",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);

  return new NextResponse(upstream.body, { status: 200, headers });
}
