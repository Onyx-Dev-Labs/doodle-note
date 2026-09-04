import { NextResponse } from "next/server";

import {
  isMultiRangeRequest,
  updateProxyRequestHeaders,
  updateProxyResponseInit,
} from "@/lib/update-proxy";

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

  // Vercel Blob accepts one range but treats a combined range as a full-file
  // request. Reject combined ranges immediately so older electron-updater
  // clients abandon the differential attempt and fall back to one full stream.
  // New packages disable combined-range downloads in app-update.yml below.
  if (isMultiRangeRequest(request.headers.get("range"))) {
    return new NextResponse(null, {
      status: 416,
      headers: { "accept-ranges": "bytes" },
    });
  }

  const upstream = await fetch(`${BLOB_BASE}/${encodeURIComponent(name)}`, {
    redirect: "follow",
    headers: updateProxyRequestHeaders(request),
    // Manifests must be fresh; Next's fetch cache would defeat the 60s TTL.
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Upstream ${upstream.status}` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new NextResponse(upstream.body, updateProxyResponseInit(name, upstream));
}
