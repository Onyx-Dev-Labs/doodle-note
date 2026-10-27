# Microsoft calendar authorization with MSAL Node 7.1

The desktop calendar uses MSAL Node **7.1.0** through `getAuthCodeUrl` and
`acquireTokenByCode`. MSAL 6 removed the custom interactive loopback interface;
MSAL 7's internal interactive listener requires form POST. The application keeps
its existing GET callback, cancellation controls and five-minute deadline by
owning the listener and calling the supported authorization-code APIs directly.
The source migration must be integrated with the release owner's final 7.1.0
manifest and lockfile update; this source change alone does not update dependencies.

## Request and response binding

Each attempt binds an ephemeral IPv4 loopback listener before opening the system
browser. Its redirect remains `http://localhost:<port>`, matching the existing app
registration. Readiness rejects bind errors and cancellation; a delayed bind that
completes after cancellation closes immediately.

The attempt creates a random state, an independent nonce using
`CryptoProvider.createNewGuid()`, and PKCE codes using
`CryptoProvider.generatePkceCodes()`. Authorization requests use `S256`, `query`
and `select_account`. The code exchange uses the original redirect URI, scopes,
PKCE verifier and **original nonce**. MSAL 7.1 checks for a matching ID-token nonce
before writing account/token cache entries; missing nonce and missing ID token
also reject. Callback nonce fields never supply the expected value.

Only GET requests to `/` with the attempt's exact state can complete the callback.
Missing, ambiguous or duplicated state/code/error/client-info values are rejected;
a terminal response is accepted once. The listener returns only code, state and
optional `client_info`. The redirect strips query parameters; responses are
`no-store`. Provider error descriptions are not reflected into application errors.
Neither arbitrary callback routing fields nor the optional MSAL `authCodePayload`
argument are forwarded.

## What callback client_info does (and does not do)

Both MSAL Node 5.3.1's former interactive implementation and 7.1.0's interactive
implementation pass allowlisted callback `client_info` as the supported
`AuthorizationCodeRequest.clientInfo`. This migration preserves that behavior.
In the pinned 7.1 implementation, it supplies the CCS `X-AnchorMailbox` hint on
the request to the configured Microsoft token endpoint. It cannot supply a new
authority or token endpoint. It is **not an authenticated account identity** and
nonce validation does not authenticate it.

MSAL constructs the home-account/cache identity from the **token response's**
`client_info`, not from the callback hint. When that response field is absent,
MSAL falls back to the ID token's subject for the home-account ID; tenant/local
identity also uses token claims. Callback values are not a fallback. Home and
resource-tenant identities can legitimately differ, so this migration does not
invent a callback-uid/utid equality check against ID-token oid/tid.

The pinned decoder ignores undecodable callback client-info for CCS purposes.
Structurally incomplete JSON is not fully schema validated by MSAL: for example,
a missing uid can yield an `Oid:undefined@<utid>` hint. Synthetic SDK controls
verify that absent, undecodable, conflicting and missing-uid callback values do
not replace the token-response identity or populate a different cache partition.
They also verify the subject fallback when token-response client-info is absent.
These are bounded controls, not claims about every possible malformed provider
response. The trusted token response remains MSAL's identity input.

DoodleNote still derives ownership from the returned account's environment,
client registration, home-account ID, tenant and local-account ID. A targeted
reconnect must match that complete key; a different account is rejected before
vault persistence. An explicit add can create a new account. No identity is
inferred from callback fields or display email.

## Cancellation, cache and migration

The service retains the original five-minute deadline and explicit cancellation
race over the whole attempt: listener binding, authority discovery, browser
opening, callback wait and token exchange. It checks the current authorization
generation before advancing to browser/token work and before adopting the result.
Cancellation, timeout, removal, disposal or configuration change closes the
listener, destroys active HTTP sockets and prevents the old attempt from
adopting an account. Repeated cleanup is safe. An old attempt cannot clear a new
attempt's pending state or listener.

The supported MSAL code-exchange API does not expose an abort signal here.
Cancellation **does not claim to abort an already-started token network request**
or undo a system-browser launch. Late SDK responses may finish in that attempt's
discarded in-memory client cache; the interactive client has no persistent cache
plugin. They cannot write the encrypted account vault or select a connection.
This differs from nonce failures, which reject before even the SDK cache write.

Account adoption, single-identity legacy migration, ambiguous-legacy rejection,
account selections and snapshot aliases remain in `CalendarService` and
`CalendarAccountStore`. The safeStorage-encrypted vault format is unchanged.
Existing `acquireTokenSilent` and per-account cache plugins retain epoch checks
before reads and writes, so an old refresh cannot overwrite a removed or
reconnected account. No migration clears a personal profile or exports tokens.

## Software evidence and release limits

Run only the focused software checks from repository root after installing the
integrated dependency graph with scripts disabled:

```sh
pnpm --filter desktop exec tsx --test 'src/main/calendar-*.test.ts'
pnpm --filter desktop typecheck
```

The SDK tests use real MSAL 7.1.0 (tested with msal-common 16.14.2), synthetic
network responses and local callbacks. Service tests use synthetic MSAL/Electron
boundaries and temporary fixture vaults with a test codec. They cover account
restore, multi-account and targeted reconnect behavior, cancellation/timeout at
binding/discovery/browser/token stages, bind/browser failures, late token success
after removal/reconnect, and stale silent-cache writers. Loopback tests verify
state/field checks, provider errors, repeated terminal responses, late binds and
observable destruction of incomplete HTTP sockets. No test opens a real browser,
authenticates an account, accesses a personal profile or launches Electron/models.

The release owner must still requalify the newly packaged native candidate in a
dedicated authorized profile: real Microsoft sign-in and consent, the registered
localhost redirect and browser landing page, cancel/timeout/retry, upgrade cache
restore, silent renewal, multiple tenants and wrong-account reconnect, removal
while auth/refresh is pending, and keychain-backed persistence across restart.
Software tests do not establish native sign-in, signing, notarization or release
acceptance. Existing signed artifacts and receipts are not updated by this work.

## Pinned upstream evidence

- [MSAL Node 7.1 API](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v7.1.0/lib/msal-node/apiReview/msal-node.api.md)
- [7.1 code request and nonce contract](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v7.1.0/lib/msal-node/src/request/AuthorizationCodeRequest.ts)
- [7.1 expected nonce construction](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v7.1.0/lib/msal-node/src/client/ClientApplication.ts)
- [Nonce validation before caching](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v7.1.0/lib/msal-common/src/response/ResponseHandler.ts)
- [7.1 callback client-info handling](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v7.1.0/lib/msal-common/src/client/AuthorizationCodeClient.ts)
- [5.3.1 interactive flow](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v5.3.1/lib/msal-node/src/client/PublicClientApplication.ts)
- [Token-response account identity](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/msal-node-v7.1.0/lib/msal-common/src/cache/utils/AccountEntityUtils.ts)
