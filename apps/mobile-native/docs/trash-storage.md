# Native Trash and local storage (ONY-260)

The fresh native app exposes Storage & Trash for the selected library and a Note storage menu. Moving a note to Trash immediately excludes it from normal library/search access and `LibraryRepository.resolve` source retrieval. Trash retains the entire UUID directory, including ink, personal text, transcript, summary versions, revision/migration backups and local audio. Restore retains the same note/library identities; a missing folder becomes unfiled within that library.

## Durable lifecycle and retries

`lifecycle/<note UUID>.json` is the authoritative local lifecycle receipt. It contains only library/note/operation/generation/deletion identities, states and timestamps, pending-work flags and the removed-audio timeline origin. It contains no note or transcript text. States are active, trashed and purged. A missing receipt is the original active generation (the note UUID) only for an existing compatible note. Corrupt, future-version or misowned receipts fail closed instead of making Trash active.

Every transition compares the expected generation. Restore also compares the deletion identity. Generic note saves must match the active lifecycle generation; a stale background save or processing result cannot reactivate a trashed/purged note or overwrite a restored generation. `lifecycleEvents` publishes scoped durable snapshots with operation identity for index invalidation and later sync integration. It is not a network sender or a substitute for the future sync adapter's operation queue.

Permanent deletion requires confirmation and first writes a purged receipt with cleanup pending. Only then does it remove note-specific jobs and the whole payload directory. This removes revisions, migration originals and audio together. Failure retains the pending receipt, hides the payload from normal access and exposes Retry cleanup. On restart, cleanup resumes idempotently. Completed purge receipts remain to reject stale writes; a successful file removal is never inferred from a missing UI row. Restores similarly persist intent before updating the active note generation, and restart resumes incomplete intent.

The interface blocks destructive storage actions during active recording or permission/model preparation. It stops playback before audio changes. Capture entry also refuses storage work in progress, and disk audio-directory creation refuses inactive/pending receipts. Per-note edit invalidation plus repository generation checks prevent queued edits from recreating deleted content. Concurrent edits to unrelated notes stay in memory; storage operations never reload the entire library over them.

## Retention clock

Local-only Trash expires after `30 * 86400` seconds from the persisted device timestamp. The app processes expiry during initial loading and on subsequent foreground execution when capture is idle. Backward clock changes delay expiry; forward device-clock changes can advance local-only expiry. No powered-off execution or secure-erasure guarantee is claimed.

Account-bound libraries use provisional local Trash timestamps and do not auto-purge from device time. ONY-258 defines server-authoritative deletion identity/timestamps and expiry. ONY-262 must explicitly reconcile provisional receipts with server receipts and authoritative expiry before account-library automatic cleanup; this issue does not claim that cloud synchronization is connected. Explicit confirmed local permanent deletion remains available. Exported archives, other devices, filesystem snapshots and external backups are not erased by this app's local cleanup.

## Remove audio independently

Remove local audio has its own confirmation, pending intent and idempotency identity. It deletes only `audio/`, retaining notes, ink, transcripts, summaries and source revisions. Playback availability comes from current local assets; pending removal exposes no playable files. A replay of a completed audio-removal operation does not delete audio recorded later.

Before removal the receipt retains the removed-through source timeline: the larger of the known audio end and retained transcript end. A subsequent recording starts after that origin. New audio playback subtracts the retained origin; transcript timestamps referring to deleted audio are disabled. This prevents an old transcript timestamp from accidentally playing a later recording beginning at zero. For damaged audio with unavailable duration, only known audio/transcript boundaries can be retained; no accuracy claim is made about an unreadable file.

## Storage and low-space recovery

Storage & Trash scans only the authorized selected library's known directories without running migration or recovery as a side effect. Notes/ink/history and audio are shown separately, including payload awaiting failed purge cleanup. Available device capacity is labeled as device-wide; the low-space notice uses a 500 MiB threshold. The scan is off the main actor and cached in the displayed view.

Confirmed audio/purge cleanup can proceed even when an unrelated note failed to save. Its unsaved edit stays in memory for Retry saving. Moving an unsaved target into Trash still requires that target to persist first. Intent receipts need writable storage; if the device cannot persist even a small receipt, cleanup stops safely and reports failure rather than silently deleting data. Free space outside the app before retrying in that case.

## Compatibility and rollback

Schema-2 note metadata adds an optional lifecycle generation; existing active notes retain their initial generation. Once lifecycle operations exist, do not run an older build that ignores the ledger against the mutable directory. Preserve the entire application-support directory and receipt files when rolling back code. Restoring an exported archive is separate deliberate user work, not undeleting a permanently purged identity in place. No production/customer files were deleted during development; all destructive tests use generated temporary stores or the isolated DEBUG UI-test container.

## Verification

`TrashTests` covers clock boundaries, restore, original payload retention, explicit confirmation, failed purge intent/restart, source exclusion, stale-save rejection, audio independence and replay, delete/re-record timeline, account-clock deferral, account storage isolation and missing-folder recovery. `TrashLibraryTests` covers capture guards, concurrent edits, unreadable/misowned receipt exclusion and low-space cleanup with unrelated unsaved data. The UI test uses `--ui-testing --storage-fixture`, creates synthetic silent audio in a separate container, checks both confirmation cancellation and audio removal, then Trash/restore.

Check this:

1. Open a saved note and choose Note storage > Move to Trash. Expect disappearance from Home/search, with text and audio available after Restore in Storage & Trash.
2. Cancel permanent deletion in Trash. Expect the note retained. Confirm deletion only on a disposable fixture; expect removal and no restored note after reopening.
3. Cancel Remove local audio, then confirm it on a fixture. Expect notes/ink/transcript/summary retained and old playback unavailable. Record again; new source timestamps must start after removed audio rather than reuse zero.
4. During recording or permission/model preparation, storage actions are disabled. With low space and an unrelated unsaved edit, remove disposable audio, retry saving, and verify the unrelated edit remains.
5. Review iPhone/iPad storage usage, scrolling, restore labels and pending-cleanup messaging. Physical-device pressure and long-session qualification remain ONY-241/265.
