# Desktop and web mobile-note readers (ONY-261)

The desktop sidebar's **Mobile cloud notes** view and web library's **Mobile notes
and version history** link open the same reader. It displays personal notes,
selected summary, named transcript speakers and private ink previews. There is no
cloud recording audio; the reader explicitly says playback is unavailable. Local
notes, recording and legacy sync workflows remain available independently.

The reader keeps rich notes out of the legacy desktop MeetingRecord editor. Text
and Pencil edits are explicitly unsupported here, rather than serializing a
partial projection back into mobile content. The service retains every unknown
snapshot field, source version, summary version and asset reference. Displaying
known fields does not create an editable replacement. Legacy adopted snapshots
remain in history but cannot be selected as native replacements.

Supported reconciliation:
1. Open a note and select a retained current, conflict or historical version.
2. **Use selected version** creates a new revision by copying the stored snapshot
   verbatim on the server. It preserves the alternate versions. Head and lifecycle
   preconditions prevent concurrent or stale choices from overwriting newer work.
3. **Move to Trash**, **Restore note**, and a separately confirmed **Delete
   permanently** use ONY-258's deletion identity/server-clock contract. Purged or
   expired content cannot be selected to resurrect it. Failed requests can be
   retried with the same operation identity; changed state requires refresh.

The reader loads notes and version history in bounded pages. Signed cursors bind
workspace and note/list scope. Private previews are fetched through authenticated
routes into memory-only blob URLs, revoked when the preview unmounts. Desktop
CSP permits blob images for this path; it adds no remote public image origin.
Desktop IPC keeps sync credentials in the main process, limits requests to the
configured sync service path, disables redirects and discards responses when the
linked account changes. Disconnecting or disabling sync stops new reader access.
The view requires a connection; no durable offline snapshot or preview cache is
created by this issue. A failed request displays a retry state.

Web sessions must independently pass workspace membership and the existing paid
sync entitlement check. Mutation requests must be same-origin. Bearer requests
use existing entitled device authentication. Neither route accepts a client user
identity or permission claim. JSON errors and private responses are no-store;
preview URLs/tokens/provider diagnostics are never returned to the browser.

## Compatibility and rollout

Minimum compatible **source** is this PR plus ONY-258/259 and migration0015.
The pre-reader desktop source uses version0.4.22; do not claim that version number
alone identifies a compatible installed build.
The next separately approved desktop release must include this commit. Web support
requires the deployed reader source, migrations through0015 and existing v2 rollout
configuration. Private previews additionally require the private-ink configuration
and verified private store described in `private-ink-storage.md`.

`DOODLENOTE_SYNC_V2_ENABLED` remains the reader gate. When off, its endpoints return
404 before database access. With an old schema, installed-capability detection
returns a controlled unavailable response. Source code and additive migration0015
were tested locally; no production migration, private store creation or configuration
was performed. Merging main automatically deploys web code, so a future approved
merge includes that effect. Root owns merge authorization and sequencing.

Older clients retain their legacy workflows. ONY-258 database guards prevent them
from overwriting or deleting enriched notes through legacy routes. They do not gain
Pencil editing by negotiation. Reader actions copy complete stored revisions, while
unsupported arbitrary JSON edits are rejected. No recording audio or voice-profile
sync is introduced.

Rollback before rollout: return to the previous reviewed code artifact while the
reader gate remains disabled. After assets exist, retain ONY-259's schema, cleanup
worker and private credentials even if the API is disabled. Do not drop retained
revisions or asset metadata. Migration0015 only adds a function and can remain
installed when reader code is rolled back. No production rollback is authorized
by these source instructions.

## Verification and remaining QA

- `pnpm --filter @repo/db test`: real migrated PGlite tests preserve unknown fields
  and immutable ink refs, paginate versions, and reject foreign/stale/trashed/purged
  selections. Existing sync mixed-client/long-transcript tests remain required.
- `pnpm --filter web test`: membership/entitlement/origin, bearer denial, old-schema
  behavior, private response headers and scoped cursor tests.
- `pnpm --filter desktop test`: main-process credential confinement, disabled sync,
  account-switch response rejection and existing desktop regressions.
- `BROWSER_BIN=/path/to/chrome-headless-shell node packages/cloud-reader/scripts/browser-smoke.mjs`:
  a synthetic local browser fixture actually renders the shared reader and exercises
  selection, Trash and restore. It uploads nothing and is not a physical Pencil test.
  On this host installed headless-shell1223 works; full Chrome timed out with
  `CVDisplayLinkCreateWithCGDisplay -6670` and is not counted as passing evidence.
- Web/desktop builds and typechecks plus web lint validate host integration. Each
  host injects the shared reader package against its own React peer version.

Check this after separately approved server/store setup: create handwriting,
typed notes, corrected speakers and summaries on iPad; read them in web/desktop;
select a retained version, exercise a concurrent edit and Trash/restore; reopen
on iPad and confirm original editing/history remains. Verify a wrong-account
preview returns no bytes and audio remains explicitly unavailable. Actual physical
mixed-client/private-provider QA remains unperformed. Source and synthetic tests
do not make this issue complete or released.
