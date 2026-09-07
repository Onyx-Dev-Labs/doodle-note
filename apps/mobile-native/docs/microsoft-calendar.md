# Microsoft Calendar provider (ONY-256)

The native provider implements direct read-only authorization, calendar discovery and complete calendarView traversal for Microsoft 365 work/school accounts in the global Microsoft cloud. It implements `CalendarProviderAdapter` and uses `CalendarAccountStore` for independent account connections, persisted selections, protected credentials, complete offline caches and disconnect recovery. It never reads or deletes notes, sends invitations, changes events or uses DoodleNote sync.

## Configuration and presentation

No production client ID, registration or permission change is included. ONY-257 owns the production calendar Settings/upcoming-meeting surface and wiring. Until an approved iOS public-client registration is supplied, local notes remain available and Microsoft connection should remain visibly unconfigured.

Construct `MicrosoftCalendarConfiguration(clientID:redirectURI:)` using the approved application UUID and exact registered `msauth.<bundle-id>://auth` redirect. Register that URL scheme in the host's generated Info.plist configuration. The adapter rejects web, file, FTP and ambiguous callback URLs. The actual bundle ID and registration must agree; no loopback listener or embedded password form is used.

On the main actor, construct `MicrosoftSystemBrowser(anchor:)` with a closure returning the initiating scene's visible presentation window, then `MicrosoftCalendarAdapter(configuration:browser:)`. Pass it to `CalendarAccountStore.connect(using:existing:)`, `refresh(_:using:window:)`, and the shared select/disconnect APIs. Use an explicit user connect action; do not authorize on launch. Cancel the connection task when its surface closes, and use the store's cancellation API to invalidate stale commits. The browser uses an ephemeral ASWebAuthenticationSession and unique attempt IDs, so an old cancellation/completion cannot affect a later login. It does not require a global app delegate callback handler.

## Authorization and data boundaries

The request uses the documented native public-client authorization-code flow with a cryptographically random state, nonce and SHA-256 PKCE verifier. Scopes are `openid profile offline_access https://graph.microsoft.com/Calendars.ReadBasic`; there is no client secret, application permission or write permission. The account identity uses tenant/object IDs, never email. Reauthentication must return the same account.

Identity claims are accepted only from the direct HTTPS token endpoint response after exchanging the matching authorization code and verifier. No callback-provided JWT is accepted. Audience, exact tenant issuer, tenant/object UUIDs, nonce, expiry and not-before are checked. This follows Microsoft's native-public-client guidance: the direct TLS identity-provider connection establishes token provenance, unlike an API accepting arbitrary bearer tokens or a web hybrid-flow callback. No Graph access token is parsed for identity and no independent JWT-signature validator is implied. HTTPS redirects are refused, including redirects that could move authorization headers or token POST bodies to another origin. Production transport uses an ephemeral session, no persistent cookies/cache, a timeout and a 16 MiB streamed response bound.

Access/refresh tokens and expiry stay in a private account/client-bound `CalendarSecret` envelope, stored by the shared nonsynchronizing device-only Keychain store. Renewal returns rotated credentials for atomic host persistence before reads. Errors expose safe categories rather than provider payloads, authorization codes or token values. Revoked/consent/policy failures request reauthentication; throttling carries Retry-After; transient and offline failures retain the prior complete cache. Failed refreshes never publish an initial page as a complete range.

Disconnect removes only that account's local credential/cache through the shared durable cleanup contract. It preserves event-created notes. It does not revoke tenant consent, globally sign the user out or change another connection.

## Events, pagination and supported calendars

Calendar discovery reads `/me/calendars`, following all next links with bounded calendar/page counts. CalendarView follows every page for every selected calendar in the requested range. Cursors bind account, selected calendars and window; next links must remain HTTPS on graph.microsoft.com and on the current collection path. Unexpected URL forms fail visibly instead of forwarding credentials or truncating results. Existing shared limits (1,000 calendars, 100 event pages, 20,000 events) produce errors rather than partial success.

Every Graph request asks for immutable resource IDs and UTC start/end timestamps. Single events use their immutable ID. Recurring occurrences/exceptions use immutable series ID plus the original occurrence timestamp, so rescheduling does not change note linkage. Canceled occurrences are omitted from the replacement cache. Malformed dates and unsupported source zones fail the entire refresh. All-day end remains exclusive, with the original timezone retained; missing all-day source timezone is an error rather than an assumption about the device zone.

Windows timezone names are mapped through the canonical territory-001 entries from [Unicode CLDR release 48 windowsZones.xml](https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/windowsZones.xml). The generated mapping is committed in MicrosoftTimeZones.swift; [Unicode license](../Sources/Resources/ThirdParty/Unicode-LICENSE.txt) accompanies it. IANA identifiers pass through when Foundation recognizes them. Legacy custom Outlook zones are unsupported and produce a visible invalid-response failure.

This first adapter supports calendars discoverable through the signed-in work/school user's `/me/calendars` with Calendars.ReadBasic. It does not claim specialist delegated/shared mailbox access, group calendars, resource-mailbox enumeration, national clouds, personal Outlook.com accounts, broker-based device compliance or Intune app protection. A tenant requiring a broker or prohibiting consent can reject login; no bypass or permission escalation is attempted. Real tenant policies and calendar types require authorized QA.

## Verification and Check this:

Automated fixtures cover PKCE/code exchange, nonce/state/account mismatch, cancellation, rotation/revocation, read-only scope/requests, multi-page calendars and selected-calendar events, recurrence rescheduling, canceled events, all-day/Windows timezone handling, hostile next links, cross-account/cursor rejection, throttling, malformed/oversized input, second-page offline cache preservation, restart/selection/disconnect and late browser callbacks.

Generate the project, then run the provider suite:

```sh
xcodegen generate --spec apps/mobile-native/project.yml
xcodebuild test -project apps/mobile-native/DoodleNoteNative.xcodeproj -scheme DoodleNoteNative -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' -derivedDataPath /tmp/ony256-derived CODE_SIGNING_ALLOWED=NO -only-testing:DoodleNoteNativeTests/MicrosoftCalendarTests
```

Required authorized account QA, after host integration and approved registration:

1. On iPhone and iPad, connect two distinct Microsoft 365 accounts; select different calendars, refresh a 14-day range and restart. Expect independent selections and complete event caches.
2. Cancel the browser, reject tenant consent and revoke a session. Expect no partial connection or credential disclosure; reauthentication restores only the matching account.
3. Move one recurring instance, cancel another and include a multi-day all-day event across daylight-saving time. Expect stable note linkage, canceled occurrence removal and correct originating dates. Compare all selected calendar pages with Outlook.
4. Go offline after a successful refresh, then disconnect one account. Expect explicitly stale cached events before disconnect, only that account cleared afterward, and event-created notes preserved.
5. Test enterprise policies and unsupported delegated/shared calendar types. Expect an explicit unsupported/reauthentication failure, not promises of broker or elevated mailbox access.

These fixtures and simulator builds do not verify a real Microsoft login, tenant consent, device Keychain entitlement, physical browser presentation or production registration. Those remain explicit delivery QA gates. Rollback removes the provider implementation; existing local notes are unaffected and calendar connections can be disconnected or reauthorized using the shared recovery contract.

Primary references checked 2026-09-06: [native authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [public-client token validation guidance](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens#validate-tokens), [native redirect configuration](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration#redirect-uri), [list calendars and minimum scopes](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0), [calendarView paging and UTC behavior](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), [event identity and originalStart](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0), [immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
