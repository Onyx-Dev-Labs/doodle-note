/**
 * Validates a post-sign-in `next` target: a same-site absolute path only.
 * Browsers treat `\` like `/` in URLs, so `/\evil.example` would otherwise
 * resolve as the protocol-relative `//evil.example`.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
