/** Injected only into the main-process bundle by electron-vite, never the renderer. */
declare const __DOODLENOTE_GOOGLE_CLIENT_SECRET__: string

export function googleClientSecret(): string {
  return typeof __DOODLENOTE_GOOGLE_CLIENT_SECRET__ === 'string'
    ? __DOODLENOTE_GOOGLE_CLIENT_SECRET__
    : ''
}

export function googleConfigurationError(): Error {
  return new Error(
    'Google Calendar is not configured correctly in this build. Update DoodleNote or contact support.'
  )
}

/** Never display/log raw token endpoint payloads, which may contain credentials. */
export function googleTokenError(code: unknown, description: unknown, status: number): Error {
  if (
    code === 'invalid_client' ||
    code === 'unauthorized_client' ||
    code === 'deleted_client' ||
    (typeof description === 'string' && /client_secret/i.test(description))
  ) {
    return googleConfigurationError()
  }
  if (code === 'invalid_grant') {
    return new Error(
      'Google Calendar authorization expired or was revoked. Open Settings > Calendar and reconnect Google.'
    )
  }
  if (code === 'access_denied') {
    return new Error(
      'Google Calendar access was denied. Reconnect Google and allow read-only calendar access.'
    )
  }
  return new Error(
    `Google Calendar sign-in could not finish (HTTP ${status}). Try again or contact support.`
  )
}
