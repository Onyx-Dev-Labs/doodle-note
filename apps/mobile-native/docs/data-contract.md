# Versioned local data (ONY-242)

The app retains per-note UUID directories and existing relative `audio/*.caf` paths. Schema 2 adds explicit library/folder ownership, source revision identity, event occurrence identity, and immutable summary versions. This is a local contract; it neither changes the cloud protocol nor authenticates accounts or enables generation/import/calendar providers.

## Ownership

`LibraryRecord.localID` is a fixed local-only identity, always available without an account. Additional libraries require an explicit account ID and workspace ID. `LibraryRepository` validates access against the supplied authenticated identities. The integration layer must supply only identities authenticated by its credential service. A library is never inferred from the current login, and saving an existing note with a different library is rejected.

A signed-out account's records remain on disk but are unavailable through the library and source-resolution APIs until that identity authenticates again. Paused/offline/expired sync transport does not call sign-out or change ownership. Sign-out requires capture to stop, flushes pending edits, and fails if any latest edit remains unsaved. The future credential/sync integration must use this boundary and must not expose raw `NoteDiskStore` as an authorized account reader.

Folders are scoped to a library. Moves change only folder ID; cross-library folder IDs and ownership changes are rejected. The interface defaults to recent-first notes in the selected library and supports optional folders. No user-facing fake login has been added.

## Migration and rollback

For each valid schema 1 document, migration validates the directory UUID against the document ID before writing anything. It saves exact original bytes to `note.schema1.original.json`, then writes `migration-1-to-2.json` with source SHA-256 and versions, then atomically replaces `note.json` with schema 2. The initial revision uses the note UUID so retries retain a stable identity. Audio directories are never moved. Migration retains title, personal text, ink bytes, language, original dates, transcript IDs/times/names, and speaker annotations.

An interrupted migration can be retried: the original backup must match the source bytes. A migration write failure exposes readable legacy content as read-only with an explicit storage-upgrade message. A future version, malformed document, or mismatched directory identity is preserved and reported, never rewritten. Schema downgrade writes over existing documents are rejected.

Rollback is deliberate, not an automatic destructive downgrade: stop the app, copy the entire application-support directory to a safe backup, verify the manifest SHA-256 against `note.schema1.original.json`, preserve the current schema 2 file separately, then restore the original bytes as `note.json` for the older build. This restores the pre-migration snapshot only; post-migration edits and new notes remain in the saved schema 2 copy for later recovery. Do not delete revisions or audio. No production migration or rollback was executed during development.

## Sources and summaries

Source anchors include library, note, revision, and paragraph index or transcript passage UUID. `revisions/<revision UUID>.json` retains immutable source text and speaker annotations. Paragraph indices refer to that immutable revision, not mutable editor text. Existing revision files cannot be overwritten with different content. Transcript timing remains seconds; future sync adapters must explicitly convert the desktop millisecond contract.

Summary versions are independent from personal text and ink. Generated and edited records use distinct IDs, and edited records reference an earlier retained parent. The store rejects removals, modifications, duplicate IDs, dangling selections, and invalid parents. Editing appends a version. A generated result merges into the latest note instead of replacing concurrent personal edits; an existing selected edited version remains selected for review. Source anchors must be persisted before handing them to a job or external consumer: call `flush()` and require success before publishing a revision ID.

## Jobs and event identities

`libraries.json` stores durable job state and a library/kind/idempotency key. A job reserves both its note ID and version ID before work. Retries reuse these IDs. `commit` validates the job and scope, writes output first, then marks complete. A restart between those writes returns the existing output, preserving subsequent user edits and preventing duplicate notes/summary versions. Only `commit` can complete a job; cancellation is terminal. Future workers should inspect running jobs after restart and explicitly transition them to retryable before resuming work. Last errors must contain safe diagnostic categories, never transcript content or credentials.

Event occurrence identity contains provider, provider account, calendar, event, and provider-stable occurrence ID. It excludes mutable display start time. `beginEventNote` scopes its deterministic encoded identity to the selected library, so recurring events, separate accounts, and rescheduling do not accidentally share a note.

## Responsiveness and limits

Initial document loading/migration and durable saves execute on the repository actor, away from the main actor. Editor state updates immediately. Queued snapshots coalesce by note; a rapid burst retains at most one waiting snapshot per note plus the active write. Capture preparation and backgrounding flush the queue. Save failures keep the latest edit in memory, display a retry action, and prevent successful flush/sign-out until persisted.

The stress fixture issues 200 edits with a 10 MiB ink payload without yielding, asserts at most two pending writes, flushes, and reopens the exact latest text/ink. This proves queue bounding and persistence under synthetic simulator load, not physical-device latency. The current implementation still loads the available document set into memory and writes full JSON/ink per durable save. Very large libraries, long recordings, battery/storage pressure, and physical-device performance remain qualification work under ONY-241/265; no database scalability claim is made. Search remains a basic local filter; the complete-history retrieval index is ONY-251.

## Verification and human QA

```sh
xcodegen generate --spec apps/mobile-native/project.yml
xcodebuild test -project apps/mobile-native/DoodleNoteNative.xcodeproj -scheme DoodleNoteNative -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath /tmp/ony242-derived CODE_SIGNING_ALLOWED=NO
```

`LibraryContractTests` covers original-byte migration/retry, read-only migration failure, directory identity, immutable citations, ownership/folders, summary/concurrent edits/crash replay, import replay, event identity, versions, and durable job state. `LibraryEditingTests` covers large coalesced edits, failed-save retry, folder ownership, sign-out, and reauthentication. Existing capture/ink/speech/speaker tests remain regression checks. The actual speaker-model smoke test is opt-in and is not accuracy coverage.

Check this:

1. Create a note, type text, draw ink, close/reopen the app. Expect both content types retained; pending saves should clear.
2. Create a folder from Home, open the note, select that folder, and return to Home. Filtering by the folder should find it without changing its library.
3. Open Summary in an ordinary local note. Expect a clear empty state, with personal notes preserved. In a fixture with generated versions, edit as a new version and verify the original remains visible.
4. Load a schema 1 fixture with writable storage; expect preserved dates/text/ink/transcript and original-byte backup. With simulated migration write failure, expect readable but disabled editing and an explicit recovery message.
5. Review iPhone and iPad layouts and text sizing. Physical Pencil, 2-hour recording and large-library performance qualification remain separate release gates.
