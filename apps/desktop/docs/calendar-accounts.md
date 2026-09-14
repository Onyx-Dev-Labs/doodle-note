# Mac calendar account foundation (ONY-307)

This change prepares local storage for multiple accounts. The compatibility service still activates one Microsoft connection and one Google connection. ONY-308 owns account management, multi-account polling, pagination, source labels and the Google availability gate. This is not a release of multi-account support.

## Identity and persistence

`calendar-accounts-v2` is a versioned, Electron safeStorage encrypted vault under `userData`. Each account owns its credential, calendars, event snapshot, visible-calendar selection and prompt history. Credentials and authenticated subjects stay in the main process. IPC exposes an opaque account ID and display metadata only. Cloud/library authentication is independent and unchanged.

Microsoft identity includes environment, client registration, home account ID, tenant and local account ID. Google identity uses the verified UserInfo `sub`; email and display name are not ownership keys. SHA-256 keys incorporate account, raw calendar and provider occurrence/event identity. They fit the meeting store's 512-character reference limit. Current event start time is not part of the key, so moving an occurrence's time within the same calendar retains the reference. Moving between calendars is a different source.

Writes encrypt into a unique file with mode 0600, flush it, verify decryption and atomically replace the vault. In-memory state advances only after replacement. Interrupted temporary files are ignored on restart. Missing encryption, unreadable/unsupported vaults and failed writes fail closed without overwriting the last committed vault. Account epochs and authorization/sync generations reject late writers after removal, reconnect or disposal.

## Legacy migration

Legacy token files, `calendar-cache.json`, `calendar-notified.json` and old calendar selections are migration inputs. Successful migration retains these originals; explicit disconnect removes only the relevant provider's old token file. A committed provider tombstone prevents its old credentials from returning on restart.

- Exactly one cached Microsoft identity is adopted. Multiple cached identities require explicit reconnect; dormant accounts are not silently enabled. Microsoft snapshot aliases require the legacy cached account view to corroborate the authenticated single session. Events without a known calendar or with ambiguous raw IDs receive no alias.
- Legacy Google refresh tokens first resolve their subject through authenticated UserInfo. Calendar choices are mapped against the authenticated calendar list. The old event cache has no Google owner, so its event/prompt history cannot safely be attributed and is refreshed instead of assigned by email. Historical Google notes remain readable; they are not automatically reused by raw ID.
- Repeated migration does not duplicate connections. Reconnect verifies the existing target identity. It cannot replace a connected account with another identity.
- Recording starts resolve the event and any proven legacy alias in main. An exact canonical note reference wins; a legacy reference is reused only when one non-trashed note matches. Only its reference changes. Notes, recordings and manual speaker edits remain intact. Ambiguous old notes remain ordinary readable records.

## Recovery and downgrade

For a storage error, quit the test app, restore keychain availability or disk access, and restart. The last committed vault and legacy inputs remain available. Never export decrypted tokens to diagnose this. An unsupported/corrupt vault must be preserved for investigation, not overwritten automatically.

Use an approved whole-profile backup for manual recovery, with the app stopped and the original OS keychain context. Do not combine credentials from different profile snapshots. If recovery needs file replacement or deletion in a real profile, obtain separate authorization for that exact operation.

Downgrades are limited: older apps ignore the vault and may use retained, stale legacy credentials/selections. Canonical note references remain readable but older code cannot associate them with raw provider IDs. Reverting source does not undo reference migration. Prefer a forward fix; do not promise that a downgrade restores current calendar state.

## Automated evidence

From repository root:

```sh
pnpm --filter desktop typecheck
pnpm --filter desktop test
pnpm --filter desktop lint
pnpm --filter desktop build
pnpm --filter @repo/meetings-store test
pnpm --filter doodle-note-mcp test
```

The account store tests use a clearly synthetic codec. They cover two Microsoft tenants, two Google subjects, shared raw IDs/display emails, occurrence rescheduling, restart, aliases, failed writes and removed-account writers. Service integration tests use real persistence/coordinator code with synthetic MSAL/Google/network responses. Google tests exercise loopback PKCE, verified identity, reconnect rejection, cancellation, refresh and migration storage failures. Recording preparation tests preserve historical content and reject ambiguous aliases. These are not live provider or installed-device acceptance.

The existing `scripts/test-recording-tray.cjs` can run after build with `DOODLE_PLAYWRIGHT_MODULE` pointing at an installed Playwright package. It uses an isolated profile and a synthetic capture engine through the real Electron main/preload/renderer. It does not record audio or authenticate an account.

## Human QA before merge

Use a dedicated test profile, never the normal installed DoodleNote profile. From repository root:

```sh
calendar_qa_profile="$(mktemp -d /tmp/doodlenote-calendar-qa.XXXXXX)"
echo "$calendar_qa_profile"
DOODLE_USER_DATA="$calendar_qa_profile" pnpm --filter desktop dev
```

Keep the printed/chosen profile path to relaunch the same profile. For legacy migration, prepare a dedicated profile with the previous version and an authorized test account, then quit it and launch this branch against that same test profile. Do not copy the user's production tokens into a fixture. Keep any QA data local and out of screenshots/logs.

1. With a single Microsoft test account, select a calendar and create a note with a manual speaker name. Upgrade the test profile, open Coming up, and take notes for that same event. Expect one migrated connection, retained choices and the existing note/content/name when ownership is unambiguous. Restart and repeat.
2. Open an old unowned Google note or a note whose legacy reference is ambiguous. Expect readable content. Taking notes from a current event must not attach it merely because the raw event ID matches.
3. With one Microsoft and one already authorized Google test connection, disconnect Microsoft during refresh. Expect only Microsoft events/prompt state to disappear. Google refresh and note access continue after restart. Google new-connect UI remains gated in this prerequisite.
4. Reconnect with a different identity. Expect rejection with the original identity and selections preserved. Exercise keychain/disk unavailability only in a disposable test environment; expect actionable storage recovery and no successful-persistence claim.
5. Exercise Coming up Take notes, an imminent-event prompt and the menu-bar entry. Expect correct note reuse and recording start. Confirm ad-hoc recording, stop and existing-note access remain usable.

Live account migration, actual audio capture/permissions and human credential-isolation review remain required. Do not merge or publish until those gates and required CI/review are satisfied. ONY-308 starts after ONY-307's approved merge.
