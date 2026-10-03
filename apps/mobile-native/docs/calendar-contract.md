# Calendar account contract (ONY-254)

This is the shared native account/cache/credential implementation for the Google (ONY-255) and Microsoft (ONY-256) adapters. It is independent of DoodleNote sync. No OAuth registration, actual provider login, event writing, or production account UI is enabled by this change. The DEBUG SwiftUI preview provides an interactive, entirely local fixture.

## Adapter boundary

Implement `CalendarProviderAdapter` in a provider-specific file. `authorize(existing:)` must use the native authorization flow, support task cancellation, enforce state/PKCE, and return the verified provider subject. Use Google's stable subject and Microsoft's tenant/object identity, not email or display name. Reauthentication must return the same key. The host serializes the pending attempt per provider; cancellation or replacement prevents late results from persisting credentials.

`renewCredential` returns the current or rotated opaque credential envelope. The account actor checks its generation and persists the result before calling `calendars` and `events`. Never put tokens in snapshots, logs, error strings, event IDs or pagination cursors. If rotation succeeds remotely but local Keychain persistence fails, surface storage failure and require retry/reauthentication; never report a successful refresh. Concrete adapters must encode refresh/access token and expiry into the private envelope and return typed safe failures. OAuth client registration and minimum read scopes remain provider-specific delivery gates.

Read methods must not perform event writes or send invitations. Return calendar descriptors and complete pages of occurrences. Normalize event occurrences with the existing `EventOccurrenceKey`: provider, account subject, calendar, event, original stable occurrence identity. Rescheduling changes displayed start/end, not the original occurrence key. `LibraryRepository.beginEventNote` separately scopes that key to a chosen library. Calendar disconnect never signs out a DoodleNote library and this store cannot access note directories.

Calendar lists have a 1,000-item bound; event refreshes have a 20,000-item/100-page bound and explicit errors, never truncation. Provider adapters must paginate calendar discovery within that bound. Repeated cursors and conflicting duplicate events are rejected. Retain the last complete cache on any partial failure. Nil calendar selection chooses defaults; empty selection explicitly hides all. Missing selected calendar IDs remain preferences, so temporary provider disappearance does not silently select other calendars.

## Time and retries

`CalendarDateNormalizer.instant` requires an explicit UTC/offset timestamp, rejecting device-timezone inference. `day` validates exact Gregorian date plus originating IANA zone. Adapters convert provider timezone aliases and handle provider recurrence expansion. All-day end dates remain exclusive. Refresh accepts bounded date windows of at most 32 days, suitable for the 14-day upcoming view, validates event overlap and retains timezone metadata.

One refresh runs per account. A generation change from selection, disconnect or reauthentication invalidates older results. A unique refresh ticket prevents the old task's cleanup from clearing a newer task's busy state. Cross-account requests can proceed independently. Rate-limit failures carry a provider retry date and block premature retry. Transient failures set an exponential 2-to-256-second retry date; callers schedule the next attempt, rather than the store running an invisible background loop. Offline/reauthentication failures preserve cached events with explicit status.

## Persistence, protection and recovery

Cache JSON is atomically replaced with complete-until-first-authentication file protection in a backup-excluded directory. Credentials use nonsynchronizing Keychain generic-password items scoped by service plus unambiguous encoded account key, accessible after first unlock on this device only. No shared credentials or account identity moves are implicit. Caller supplies a dedicated calendar cache directory, outside notes/archives. Future archive code must not include it.

New connections persist a disconnecting cleanup intent before writing Keychain, then commit connected metadata. If credential/cache commit and cleanup fail, the intent remains for `finishPendingDisconnects()` on next launch. Reauthentication preserves the existing account and fresh credentials if cache update fails, exposing failure rather than rolling back a possibly rotated refresh token. Disconnect first invalidates in-flight work, persists a cleared disconnecting snapshot, removes only that account's Keychain item, then removes the cache record. Retry is idempotent. Callers must expose failed cleanup and retry it on launch; disconnect is not successful until it returns successfully. No note/audio/ink/summary is deleted.

Rollback: no existing note schema or cloud schema changed. Preserve the dedicated calendar cache until pending cleanup completes, then a previous build can continue local notes. Reconnecting providers is the recovery path if disposable calendar cache is lost; notes remain independent.

## Verification and Check this:

Run normal unsigned regression coverage:

```sh
xcodegen generate --spec apps/mobile-native/project.yml
xcodebuild test -project apps/mobile-native/DoodleNoteNative.xcodeproj -scheme DoodleNoteNative -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' -derivedDataPath /tmp/ony254-derived CODE_SIGNING_ALLOWED=NO
```

Unsigned simulator hosts lack Keychain entitlements (`-34018`); the actual Keychain roundtrip explicitly skips only that environment, while the mock isolation/failure tests run. For actual OS Keychain validation, create a temporary plist with `application-identifier` and `keychain-access-groups` set to `TEST.ai.doodlenote.native.prototype`, then run the calendar suite with `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_ENTITLEMENTS=/absolute/path/to/test.entitlements`. This is simulator-only ad-hoc test signing, not a production entitlement or provisioning change.

1. Open the generated project in Xcode, open `Sources/Calendar/CalendarPreview.swift`, and start the `CalendarContractPreview` Canvas on iPhone and iPad. Connect fixture accounts, then Refresh. Expect two independent accounts with one fixture event each and no network requests.
2. Simulate offline refresh on one account. Expect `offline` result with cached events retained and the other account unchanged.
3. Require reauthentication, then Reauthenticate on that account. Expect its stable account restored without duplicating it. Refresh again to recover normal state.
4. Disconnect one account. Expect only that account removed; the other remains. Production note creation is deliberately outside this fixture and remains unchanged.
5. Inspect credential failure/restart and cancellation tests, and run signed Keychain validation before connecting real providers. Physical device Keychain and actual provider consent/revocation are additional gates in 255/256.

References checked 2026-09-06: [Apple Keychain accessibility](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly), [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Microsoft calendar view](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0). Google documents mobile loopback redirects as deprecated; native adapters must not copy desktop loopback authorization.
