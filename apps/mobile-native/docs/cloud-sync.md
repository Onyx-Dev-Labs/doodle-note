# Optional native cloud libraries (ONY-262)

Cloud sync is opt-in. Connecting an account opens only that account's cached libraries; the user must choose or create a cloud library before notes upload. Existing local-only notes are never silently moved. The app remains usable without an account, network, subscription or configured sync service.

## Identity and entitlement

The native browser link carries a random state and a native-library purpose. The callback supplies a credential, not trusted account claims; `/api/sync/account` resolves current account and workspace membership. Credentials live in device-only Keychain slots, not notes, URLs in persisted state, or logs. Redirects, cookies and response caching are disabled for the native HTTP transport. Responses have size bounds.

A lapsed account can receive an identity-only `dnid_` credential to reopen its own cache. Data routes accept only entitled `dnsy_` credentials and current membership. Prefix substitution does not upgrade a token because the entire credential is hashed. Existing desktop authorization remains compatible. HTTP 402 pauses sync while preserving cached access; transport failure does not imply revocation. Positive permission denial locks the affected account immediately. Only a recording belonging to that account is interrupted and durably recovered; an independent local-only recording continues. Explicit sign-out locks cached account content until the same account reconnects. Account/workspace/library/note IDs are mapped into distinct local namespaces with durable reverse bindings.

## Durable synchronization

The protected journal retains operation IDs, exact retry payloads, account/library bindings, acknowledgements and a pending pull page. A page is saved before its revisions are imported; the cursor advances only after replay completes. Lost acknowledgements resend the same immutable operation. Imports use durable intents and local revision/lifecycle preconditions. Recording notes and unsaved edits are deferred; a refresh cannot overwrite an edit completed while disk loading was suspended or reinsert a note purged during that read.

The projection preserves typed source revisions, title and summary anchors, transcript passages and provisional completion, speaker turns, immutable summary history, selection and ink references. It explicitly excludes audio, local paths, voice profiles, credentials and model state. Imported notes have no fabricated audio availability. Missing remote transcript completion is conservative, and a finished recording with no passages is not marked complete. Unknown or legacy payload fields remain in retained raw revisions and make the imported note read-only instead of being silently discarded.

Each cycle processes bounded pages and continues automatically when more work remains. Failed requests retain the journal with bounded retry delays and connectivity-triggered retries. Manual Sync now remains available. Conflicts preserve both histories. Review shows device and cloud text; choosing the cloud head requires the previewed revision and an already-retained device conflict. A late preview for another note cannot replace the selected preview. Rich legacy imports remain read-only; use desktop/web version history for unsupported edits.

## Trash and private ink

Trash and restore carry deletion identities and independent lifecycle generations. Account-local timestamps are provisional until server receipts arrive. Device-clock expiry cannot authorize cloud deletion. A local permanent purge creates a durable receipt before removing note data, cached snapshots, ink plans, pending import intents and queued content. Minimal bindings remain so an accepted first upload with a lost reply can later be found and purged. Old Trash replies cannot undo a newer local restore. Server purge receipts prevent stale upserts from restoring deleted payloads.

Editable PencilKit data and normalized static RGB/RGBA previews use the existing private ink API. Pending immutable version IDs and bytes survive restart; each part reauthorizes. Downloads bind account, library, note, revision and version, and never store provider URLs. Downloaded ink caches are distinct from pending upload reservations. Native v1 has one editable canvas per note. A payload with multiple ink attachments is preserved remotely but deferred as unsupported, never flattened or partially overwritten. Real private-store and physical Pencil round-trip qualification remains required.

## Existing desktop notes

Find desktop notes pages through only the authenticated workspace's unadopted legacy notes. Users review counts, select notes and confirm adoption. Migration 0016 adds a transactional explicit-adoption function; it performs no backfill by itself. The original note IDs, full transcript and original typed/generated markdown envelopes are retained. Replay, a foreign account's operation ID, Trash and permanent purge cannot create a new active copy. Once adopted, old destructive desktop writers are blocked by the earlier versioned-sync guards.

## Configuration and rollout

No production migration, private store, token, permission or rollout flag was changed by this work. Native sync requires the previously reviewed versioned sync/private ink/readers schema and configuration, plus migration 0016 for explicit desktop adoption. The v2 API and adoption remain disabled when their rollout flag is off; discovery reports unavailable on older schemas. A separate private store/token is required for private ink and must never fall back to public storage. The existing cleanup worker remains available independently of disabling the upload/read API.

Merging source automatically deploys web code through the repository's Vercel integration. This includes additive account-link and membership checks even while v2 remains disabled. Before migration/activation, a previous Vercel artifact is the rollback. After versioned data is adopted, retain the purge adapters and legacy write guards; do not roll back to a destructive legacy writer. Native distribution, migration application, flag activation and real-provider setup are separate release actions.

## Verification and remaining qualification

Synthetic native tests exercise restart imports, lost response replay, local purge before first acknowledgement, obsolete import intent cleanup, cross-account access denial, stale refreshes, recording preparation revocation, private ink retry/download authorization, and conflict preview selection. Actual disposable PGlite/PostgreSQL tests exercise the real migration/function, adoption isolation and replay, Trash/purge and migration rollback/reapply. Web handler tests cover identity-only, paid/lapsed membership and old-client compatibility. UI smoke checks optional settings in English and German without opening a real sign-in session.

Local simulator and CI evidence are recorded with the PR. They do not prove a real service account round trip or physical device behavior. Required remaining QA: authorized nonproduction iPhone/iPad/desktop sync with ink, offline edits and Trash, real entitlement lapse/reconnect and account switching, private-provider behavior, and qualified five-language review. All translated cloud strings are machine drafts. Keep ONY-262 In Review until its explicit manual QA boundary is met.
