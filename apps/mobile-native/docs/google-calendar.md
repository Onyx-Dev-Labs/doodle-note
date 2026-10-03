# Native Google Calendar adapter (ONY-255)

Implements the provider behind ONY-254's account store: native browser authorization, code exchange and refresh, stable Google subject identity, complete selected-calendar reads and safe failure handling. There is no built-in client registration and no Google login enabled in the current Home screen. Actual authorized two-account QA remains required before issue completion or external beta.

## Configuration and app integration

Supply `GoogleCalendarConfiguration(clientID:redirectURI:)` with a product-owned **iOS OAuth client**, matching the app bundle ID. This implementation accepts that client's reversed-ID scheme with `/oauth2redirect`, for example `com.googleusercontent.apps.<client-prefix>:/oauth2redirect`; register and verify that exact URI. Do not use the desktop client or a loopback URI. Missing/invalid configuration fails closed. No client secret belongs in a native app.

The integration owner must add the approved scheme to `CFBundleURLTypes` in the generated Info.plist source (`project.yml`), provide a valid visible window/presentation anchor, and retain `GoogleNativeAuthorization`. Construct the adapter with a browser closure calling `await authorization.open(url, callbackScheme: scheme)`. ASWebAuthenticationSession owns this callback; no guessed global callback routing or provider SDK dependency is needed. Root/app wiring is deliberately separate from the provider files to avoid collisions with Microsoft work.

An app-owned settings coordinator can construct the provider as follows after configuration approval. The coordinator must retain `browser`, provide its active window, call `finishPendingDisconnects()` at startup, and keep tasks so Cancel can cancel the authorization task as well as `store.cancelConnect(.google)`:

```swift
// MainActor settings coordinator; values come from approved injected configuration.
let browser = GoogleNativeAuthorization { activeWindow }
let config = try GoogleCalendarConfiguration(clientID: approvedClientID, redirectURI: approvedRedirectURI)
let provider = GoogleCalendarAdapter(configuration: config) { url, scheme in
    try await browser.open(url, callbackScheme: scheme)
}
let store = try CalendarAccountStore(directory: dedicatedCalendarCacheDirectory)
try await store.finishPendingDisconnects()
let account = try await store.connect(using: provider)
let range = try CalendarWindow(start: Date(), end: Date().addingTimeInterval(14 * 86400))
try await store.refresh(account, using: provider, window: range)
// Display snapshots; selected calendar IDs belong only to this account.
try await store.select(selectedIDs, for: account)
try await store.disconnect(account)
```

Authorization uses 256-bit random state and verifier, S256 PKCE, exact redirect/state validation, duplicate-parameter rejection, and an ephemeral system browser requesting account selection and consent. Cancellation closes its session; per-attempt identities reject stale callbacks and adapter results. Auth codes are exchanged once per attempt. Google userinfo supplies the stable subject; no unverified ID-token payload is trusted. Verified email is display-only and never the account key. Existing-account reauthorization rejects a changed subject.

Requested scopes: `openid`, `email` (distinguishable account display), `calendar.calendarlist.readonly` and `calendar.events.readonly` under the Google API scope namespace. Scope validation accepts Google's canonical `userinfo.email` alias. These cover identity, calendar listing and event reading only. No event writes, invitations, Drive, or background service account access. Enable Calendar API and configure consent/test users in the product-owned project. Any production registration, scopes, verification or publishing changes require separate authorization.

## Credentials and requests

The opaque `CalendarSecret` contains subject, client ID, access/refresh tokens and expiry. The existing account store exclusively persists it in device-only Keychain. Renewal retains an omitted refresh token, accepts a rotated token, and binds credentials to both subject and client. The account store commits renewed credentials under a generation check before calendar calls. Google adapter does not maintain a second SDK token cache, so account disconnect uses the existing targeted Keychain/cache cleanup without hidden SDK sessions. It does not revoke tokens remotely or sign out other browser accounts.

Fixed HTTPS endpoints use an ephemeral URLSession, no cookies/cache or credential-bearing redirects, a 30-second request timeout and an 8 MiB streamed response cap. Calendar paths are encoded as path components. HTTP401/invalid_grant and missing permissions require reauthentication; consent/policy failures remain explicit safe errors. HTTP429 and Google403 rate-limit reasons carry bounded Retry-After dates (seconds or HTTP date), and server failures are transient. No raw provider response/error, request or credential is logged.

## Complete calendar/event reads

Calendar listing reads all pages up to the shared 1,000-calendar bound; a failed later page fails the whole refresh. Event pages traverse every selected calendar and provider page through a cursor bound to subject, exact sorted calendar selection and date window. Cursors are opaque data, never URLs; changed contexts are rejected. Shared account-store limits and cycle detection prevent infinite pagination. No first-page-only success or silent truncation.

Events use `singleEvents=true` to expand recurring meetings and `showDeleted=true` to explicitly exclude canceled occurrences. A series occurrence uses the recurring series ID and original start identity, so a reschedule changes its displayed time without changing its note link. Nonrecurring event identity uses its stable event ID. All-day dates retain the provider's originating timezone and exclusive end date. Missing all-day timezone, malformed dates, incomplete active events and invalid pages fail explicitly, preserving the old complete cache. Date-time values require explicit offsets. Specialist access beyond calendars returned with reader-or-better access is not promised.

## Verification and Check this:

```sh
xcodegen generate --spec apps/mobile-native/project.yml
xcodebuild test -project apps/mobile-native/DoodleNoteNative.xcodeproj -scheme DoodleNoteNative -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath /tmp/ony255-derived -only-testing:DoodleNoteNativeTests/GoogleCalendarTests CODE_SIGNING_ALLOWED=NO
```

The HTTP/browser fixtures verify PKCE/state/redirect/replay/cancellation, two subjects, wrong-account reauth, rotation/revocation, complete calendar/event pages, recurrence/reschedule/cancel/all-day behavior, context-bound cursors, throttling and explicit failures. They do not prove provider registration, Google's real consent experience or production account behavior.

After approved registration and app presentation wiring:

1. Connect two authorized Google test accounts. Confirm distinguishable emails, independent calendar selections and local notes without DoodleNote sync.
2. Select calendars containing recurring, rescheduled, canceled and all-day meetings across a timezone/DST boundary; verify all pages and unchanged event-note identity after rescheduling.
3. Deny/cancel login and revoke one account's consent. Expect clear cancellation/reauthentication, old cache labeled stale and the other account unchanged.
4. Go offline, then reconnect; verify cached events persist and successful refresh replaces the complete range. Disconnect one account; its credentials/cache disappear while created notes and the other account remain.
5. Validate the native callback and Keychain on signed iPhone/iPad builds. Unavailable registrations/accounts mean these checks remain pending, not passed by mocked tests.

No existing schema migration or cloud rollout. Rollback removes provider wiring while local notes remain intact; dispose only this provider's account/cache through the existing disconnect API. Production configuration has not been changed.

Primary references checked 2026-09-06: [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [calendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [OpenID/userinfo](https://developers.google.com/identity/openid-connect/openid-connect).
