import { NextResponse } from "next/server";

import { downloadArtifactFromManifest } from "@/lib/download-artifact";

/**
 * Never-drifting download links: /download/mac and /download/win resolve the
 * CURRENT version from the same electron-updater manifests the apps use
 * (public/updates/latest-mac.yml / latest.yml) and 302 to its installer. macOS
 * gets the matching DMG; its in-app updater keeps using the ZIP. Born from an
 * incident where the landing page hardcoded versioned artifact names and quietly
 * served 0.3.5 after 0.3.6 shipped — a manifest and this redirect cannot disagree.
 */

const MANIFESTS: Record<string, string> = {
  mac: "latest-mac.yml",
  win: "latest.yml",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const manifest = MANIFESTS[platform];
  if (!manifest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Self-fetch the manifest instead of reading the filesystem: public/ assets
  // aren't bundled into serverless functions, but they're always servable.
  const upstream = await fetch(new URL(`/updates/${manifest}`, request.url), {
    cache: "no-store",
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: "Manifest unavailable" }, { status: 502 });
  }
  const artifact = downloadArtifactFromManifest(platform, await upstream.text());
  if (!artifact) {
    return NextResponse.json({ error: "Malformed manifest" }, { status: 502 });
  }
  return NextResponse.redirect(new URL(`/updates/${artifact}`, request.url), 302);
}
