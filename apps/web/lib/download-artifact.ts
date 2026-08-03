const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Website downloads are intentionally independent from desktop update feeds.
 * Windows remains a public beta until its Authenticode signing is configured,
 * so the website may serve a beta installer without offering it to installed
 * clients through latest.yml.
 */
const DOWNLOAD_MANIFESTS: Record<string, string> = {
  mac: "latest-mac.yml",
  win: "latest-beta.yml",
};

export function downloadManifestForPlatform(platform: string): string | null {
  return DOWNLOAD_MANIFESTS[platform] ?? null;
}

/** Resolve the public artifact for a website download without changing the updater feed. */
export function downloadArtifactFromManifest(
  platform: string,
  manifest: string,
): string | null {
  if (platform === "mac") {
    const version = /^version:\s*["']?([^\s"']+)["']?\s*$/m.exec(manifest)?.[1];
    if (!version || !SAFE_VERSION.test(version)) return null;
    return `DoodleNote-${version}-arm64.dmg`;
  }

  if (platform === "win") {
    return /^path:\s*(\S+)\s*$/m.exec(manifest)?.[1] ?? null;
  }

  return null;
}
