const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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
