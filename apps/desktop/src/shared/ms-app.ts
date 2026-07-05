/**
 * DoodleNote's Microsoft app registration (Entra).
 *
 * A public-client Application ID is not a secret — desktop apps ship theirs
 * in code by design (there is no client secret in the PKCE flow). The
 * registration is multi-tenant + personal Microsoft accounts, so sign-in
 * goes through the universal "common" authority: any work, school, or
 * personal account can connect with one click.
 *
 * Empty string = no built-in registration; Settings then falls back to the
 * manual Client ID / Tenant ID form (self-hosters bringing their own).
 */
export const BUILT_IN_MS_CLIENT_ID = ''
export const BUILT_IN_MS_TENANT = 'common'
