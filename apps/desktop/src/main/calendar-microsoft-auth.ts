import {
  CryptoProvider,
  ResponseMode,
  type PublicClientApplication,
  type AuthenticationResult
} from '@azure/msal-node'
import { CalendarAuthLoopback } from './calendar-auth-loopback'

/** The service owns the deadline/generation; MSAL owns token validation and its private cache. */
export async function acquireCalendarMicrosoftToken(
  client: Pick<PublicClientApplication, 'getAuthCodeUrl' | 'acquireTokenByCode'>,
  loopback: CalendarAuthLoopback,
  scopes: string[],
  openBrowser: (url: string) => Promise<void>,
  assertActive: () => void,
  successTemplate: string,
  errorTemplate: string
): Promise<AuthenticationResult> {
  const callback = loopback.listenForAuthCode(successTemplate, errorTemplate)
  // A cancelled callback can reject while discovery or browser opening is still pending.
  void callback.catch(() => {})
  try {
    const redirectUri = await loopback.waitForRedirectUri()
    assertActive()
    const crypto = new CryptoProvider()
    const nonce = crypto.createNewGuid()
    const { verifier, challenge } = await crypto.generatePkceCodes()
    assertActive()
    const url = await client.getAuthCodeUrl({
      scopes,
      redirectUri,
      state: loopback.state,
      nonce,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      responseMode: ResponseMode.QUERY,
      prompt: 'select_account'
    })
    assertActive()
    await openBrowser(url)
    assertActive()
    const response = await callback
    assertActive()
    // State was checked by our listener. Do not forward callback routing/nonce fields
    // through MSAL's optional authCodePayload: only the original nonce is trusted.
    const result = await client.acquireTokenByCode({
      scopes,
      redirectUri,
      code: response.code,
      codeVerifier: verifier,
      nonce,
      clientInfo: response.client_info
    })
    assertActive()
    return result
  } finally {
    loopback.closeServer()
  }
}
