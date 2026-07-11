import { NextResponse } from "next/server";

/**
 * Never-drifting download links: /download/mac and /download/win resolve the
 * CURRENT installer from the same electron-updater manifests the apps use
 * (public/updates/latest-mac.yml / latest.yml) and 302 to it. Born from an
 * incident where the landing page hardcoded versioned artifact names and
 * quietly served 0.3.5 after 0.3.6 shipped — a manifest and this redirect
 * can no longer disagree.
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
  // electron-updater manifests are trivially line-shaped; `path:` names the
  // primary artifact. No YAML dependency needed.
  const match = /^path:\s*(\S+)\s*$/m.exec(await upstream.text());
  if (!match) {
    return NextResponse.json({ error: "Malformed manifest" }, { status: 502 });
  }
  return NextResponse.redirect(new URL(`/updates/${match[1]}`, request.url), 302);
}
