/**
 * Shared by the download form and the server. The server stores this exact
 * wording and version with each granted permission, so changing the wording
 * means bumping the version.
 */
export const DOWNLOAD_PLATFORMS = ["mac", "win"] as const;
export type DownloadPlatform = (typeof DOWNLOAD_PLATFORMS)[number];

export function isDownloadPlatform(value: unknown): value is DownloadPlatform {
  return DOWNLOAD_PLATFORMS.includes(value as DownloadPlatform);
}

export const DOWNLOAD_PLATFORM_LABELS: Record<DownloadPlatform, string> = {
  mac: "macOS",
  win: "Windows (beta)",
};

export const MARKETING_CONSENT_VERSION = "download-marketing-2026-10-29";
export const MARKETING_CONSENT_TEXT =
  "Email me DoodleNote setup tips, product updates, and occasional offers for optional Cloud Sync. I can unsubscribe at any time.";
