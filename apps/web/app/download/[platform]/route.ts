import { NextResponse } from "next/server";

import {
  downloadArtifactFromManifest,
  downloadManifestForPlatform,
} from "@/lib/download-artifact";
import {
  DOWNLOAD_GRANT_COOKIE,
  readCookie,
  verifyDownloadGrant,
} from "@/lib/download-grant";

/**
 * Never-drifting download links: /download/mac and /download/win resolve the
 * CURRENT website version from a platform-specific manifest and 302 to its
 * installer. macOS gets the matching DMG from the production feed. Windows
 * uses latest-beta.yml so an unsigned beta can be tested without changing the
 * production updater feed in latest.yml. Born from an incident where the
 * landing page hardcoded versioned artifact names and quietly served 0.3.5
 * after 0.3.6 shipped — a manifest and this redirect cannot disagree.
 *
 * Website visitors reach it through the /download email form, which sets a
 * short-lived grant cookie. Without one, this sends them to the form with the
 * platform kept. Installed apps never use this route: they update from
 * /updates, which stays public.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const manifest = downloadManifestForPlatform(platform);
  if (!manifest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!verifyDownloadGrant(readCookie(request, DOWNLOAD_GRANT_COOKIE))) {
    const form = new URL("/download", request.url);
    form.searchParams.set("platform", platform);
    const redirect = NextResponse.redirect(form, 307);
    redirect.headers.set("cache-control", "private, no-store");
    return redirect;
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
  const redirect = NextResponse.redirect(new URL(`/updates/${artifact}`, request.url), 302);
  redirect.headers.set("cache-control", "private, no-store");
  return redirect;
}
