import { createHmac, timingSafeEqual } from "node:crypto";

import { resolveAuthSecret } from "./runtime-config";

/**
 * A short-lived, signed cookie set once a download request is stored. The
 * /download/<platform> redirect requires it, so website visitors pass the
 * email form first. It is not access control for the installers themselves:
 * /updates stays public because installed apps update from it.
 */
export const DOWNLOAD_GRANT_COOKIE = "dn_download_grant";
export const DOWNLOAD_GRANT_TTL_SECONDS = 30 * 60;
const VERSION = "v1";

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("doodlenote-download-grant-v1").digest();
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
}

export function createDownloadGrant(
  nowMs = Date.now(),
  secret = resolveAuthSecret(),
): string {
  const payload = `${VERSION}.${Math.floor(nowMs / 1000) + DOWNLOAD_GRANT_TTL_SECONDS}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyDownloadGrant(
  value: string | null | undefined,
  nowMs = Date.now(),
  secret = resolveAuthSecret(),
): boolean {
  const parts = value?.split(".");
  if (!parts || parts.length !== 3 || parts[0] !== VERSION) return false;
  const expires = Number(parts[1]);
  if (!Number.isSafeInteger(expires) || expires * 1000 <= nowMs) return false;
  const supplied = Buffer.from(parts[2]);
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function downloadGrantCookie(grant: string, secure: boolean): string {
  return [
    `${DOWNLOAD_GRANT_COOKIE}=${grant}`,
    "Path=/download",
    `Max-Age=${DOWNLOAD_GRANT_TTL_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
