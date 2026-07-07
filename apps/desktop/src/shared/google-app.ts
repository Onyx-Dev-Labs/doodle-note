/**
 * DoodleNote's Google OAuth client (Desktop-app type).
 *
 * Installed-app credentials are not confidential by design — Google's
 * desktop OAuth model ships them in the binary and secures the flow with
 * PKCE + the loopback redirect instead. Calendar access is read-only.
 */
export const BUILT_IN_GOOGLE_CLIENT_ID =
  '788495366298-3u0etj9tpm6jfrnlv8igcrm0t18mkrmr.apps.googleusercontent.com'
export const BUILT_IN_GOOGLE_CLIENT_SECRET = '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'
