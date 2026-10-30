# DEV-512: optional local vault decision and recovery experiment

Status: **proposed; awaiting Sean's product decision and technical review**.
Date: 2026-10-17. [Notion DEV-512](https://app.notion.com/p/3fcf0f846ee481a1a865c71893bbff8b).
Inspected desktop baseline: `b53c078685b00d901a321192e886574ff0c17701` (source version 0.4.33).
This document and disposable probe do not change product behavior or authorize migration.

## Proposed decision

Retain portable original files for the weekend release. Explain that these are readable local files and that operating-system volume protection is a separate control. Do not describe credential encryption or an encrypted search database as a content vault.

Consider an optional, account-independent vault in a separate implementation after approving its threat model and recovery experience. It would need a versioned storage boundary covering every writer and reader, including native audio capture and derived data. Keep plaintext-library support. Do not silently convert existing libraries, delete original recovery copies, or change MCP consent.

Sean must accept or amend this recommendation, including the tradeoff between loss of recovery material and irreversible content loss. Alec is the requested repository technical reviewer; specialist cryptography review of a later production format remains outstanding. This report does not claim either approval.

## Threat model and alternatives

The proposed vault addresses disclosure from a copied or stolen **locked vault**, its ciphertext backups, and a missing encrypted removable drive when the attacker lacks device and recovery keys. Authenticated encryption should detect changed ciphertext and incorrect keys. It cannot establish who authored a meeting, whether a whole valid old vault was replayed, or whether a backup is the newest one.

Excluded: end-to-end encryption of cloud sync/provider requests; an unlocked compromised application or OS; malware able to retrieve keys; screenshots, clipboard, authorized exports and recipients' copies; guaranteed erasure of old plaintext, swap, snapshots or backups; concealment of all file sizes, timing and vault existence. An app lock is a lifecycle/authorization requirement, not proof that all process-memory copies disappeared.

| Alternative | Benefit | Limit / decision |
| --- | --- | --- |
| Existing plaintext originals plus OS volume protection | Portable, account-free, compatible with current capture, recovery, MCP and tools | No independent app lock; copies onto another unprotected volume remain readable. Recommended weekend behavior. |
| Encrypt only SQLite or meeting JSON | Narrower engineering change; protects that specific copy | Audio, images, sessions, temporary files and exports remain exposed. Not an acceptable whole-library vault claim. |
| Separate opt-in vault with device unlock and independent recovery material | Can protect copied ciphertext and allow portable recovery without an account | Requires comprehensive storage mediation, recovery UX, migration/rollback and old-client handling. Proposed future scope. |

Apple documents FileVault as volume encryption and treats removable storage separately. We have **not checked or changed FileVault on any user's machine**. FileVault does not provide DoodleNote's independent app lock. Electron `safeStorage` is suitable to evaluate for device-wrapping material, not a portable content format: platform behavior differs, and its Windows protection does not isolate other applications in the same user session. Linux can have an insecure fallback. These are platform constraints, not a cross-platform security guarantee. [Apple volume encryption](https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Source inventory and containment boundary

Paths below are relative to the selected library unless marked otherwise. Source links are repository-relative; the inspected baseline above is authoritative. This is a source inventory, not forensic proof that an installed machine has no other plaintext residue.

| Data / copy | Current evidence | Future vault requirement |
| --- | --- | --- |
| Meeting JSON, transcripts, personal edits, summaries, trash | [MeetingFileStore](../../../packages/meetings-store/src/store.ts) writes `meetings/<id>.json` via plaintext temporary file and rename; normalization selects recognized fields | Encrypt raw original bytes and metadata; preserve richer/unknown fields during migration. Trash remains protected. |
| Capture-session transcript snapshots | [TranscriptSession](../../../apps/desktop/src/main/transcript-session.ts) writes `sessions/session-*.json` | Include sessions and their recovery path, not just final meeting records. |
| Saved/imported audio and part metadata | [AudioService](../../../apps/desktop/src/main/audio-service.ts): `audio/<meetingId>/<session>/audio.m4a`, imported copies, `part.json` | Cover originals, imported copies, timing and channel metadata; maintain playable recoverable parts. |
| Native capture checkpoints | [AudioRecorder.swift](../../../engine/Sources/engine/AudioRecorder.swift): rotating CAF checkpoints and `manifest.json`, merged audio; Windows has a separate recorder | Native writers must participate. A JavaScript wrapper around final saves is insufficient. |
| Transcription staging | [Whisper transcriber](../../../apps/desktop/src/main/whisper-transcriber.ts): OS temporary `doodlenote-whisper-*`, per-channel WAV and transcript JSON; Windows engine host has its own temporary staging | Contain staging and handle crash residue. `finally` cleanup alone is not a protection boundary. |
| Images/attachments and media delivery | [MediaService](../../../apps/desktop/src/main/media-service.ts): `attachments/<uuid>.<ext>`, file-backed protocol responses | Gate protocol reads and thumbnails; no decrypted persistent browser cache. |
| Folders and global conversations | [FoldersService](../../../apps/desktop/src/main/folders-service.ts), [NotesService](../../../apps/desktop/src/main/notes-service.ts): `folders.json`, `global-chat.json` | Protect names, prompts, answers and metadata, including historical artifacts. |
| Relocation/staging/recovery copies | [LibraryStorage](../../../apps/desktop/src/main/library-storage.ts) explicitly copies `meetings`, `audio`, `attachments`, `sessions`, folders and chat; verifies hashes, retains original `recoveryPath` | Copy ciphertext with its identities; never imply preserved plaintext backups became protected. Reconcile staging and pending relocation before migration. |
| Index and source identity (unmerged DEV-506) | [PR #223](https://github.com/Onyx-Dev-Labs/doodle-note/pull/223), inspected `bd2fa54ce53e1d6ccb5577aaf888699690c9f006`: `userData/derived-source-index/sources-v1.sqlite`, WAL, meetings identity sidecar | Derived content is as sensitive as originals. Include journal/temp modes and lock-time close/cleanup; identity must survive relocation. Not in baseline. |
| Recipes and future evidence artifacts | DEV-510 is concurrent work; future briefs/screenshots may add stores | Require a storage registry and vault compatibility review for each writer. No claim these paths are already implemented here. |
| Settings/account data outside library | [NotesService](../../../apps/desktop/src/main/notes-service.ts) encrypts provider keys; [CalendarAccountStore](../../../apps/desktop/src/main/calendar-account-store.ts) encrypts current account payloads. [Sync config](../../../apps/desktop/src/main/sync-config.ts) encrypts its token but stores other metadata outside that value | Do not bundle machine credentials as portable library recovery material. Classify metadata and legacy calendar-cache residue separately; do not describe the current encrypted calendar store as plaintext. |
| Exports, clipboard, cloud sends | [ExportService](../../../apps/desktop/src/main/export-service.ts) writes selected Markdown/PDF destinations; sync/provider requests have separate policy | Explicitly leave protected storage only through authorized export/send. Explain resulting plaintext; locking cannot revoke external copies. |
| Diagnostics, browser profile, OS residue and backups | Main engine-event logging redacts transcript text but retains other metadata; OS/browser crash caches, swap, snapshots, Time Machine and third-party sync are outside this source audit | Audit and minimize logs; disclose residual metadata and external copies. Do not promise erasure or completeness without installed-client testing. |

The selected library may be on removable or synchronized storage. Neither selection nor sign-in establishes protection, ownership or cloud-export permission. Preserve account-independent originals and the canonical library identity; never generate competing identities for vault/recipe/index components. Source anchors must remain resolvable after unlocking and restoring the same library.

## Proposed key, lock and access lifecycle

Use a random library content key with independently authenticated device and recovery wrapping. The actual production algorithms, format, key derivation and streaming construction require review; the toy probe below is not their specification. A high-entropy recovery secret avoids pretending a short password has equivalent strength. If a passphrase is offered later, it needs a reviewed KDF, resource limits and usable recovery UX.

Keep device unlock material outside portable library files, in an appropriate OS-protected store. Export recovery material only through an explicit flow, verify it on a separate restore before activation, and tell the user to store it separately from the vault. No server escrow or sign-in requirement is proposed. Backups need ciphertext plus independently retained recovery material; copying just a device-bound keychain blob is not portable recovery.

Missing or wrong key must produce a locked/recovery error, never an empty replacement library, overwrite, silent reset or automatic cloud fallback. Losing both usable device access and recovery material means content loss; support cannot promise recovery. If device access remains, offer verified recovery-key replacement. A compromised key requires a reviewed rekey process; rewrapping alone does not revoke copies of an old key or old backups.

An explicit lock must cancel/fence AI and source requests, stop or finish capture safely, flush protected checkpoints, revoke media/index/MCP access and release keys and plaintext references. It must not report success while a writer can still persist plaintext or a late callback can repopulate the UI. Capture interruption must explain any incomplete audio. Idle, screen-lock, suspend and crash policies need native testing; process-memory erasure cannot be guaranteed by JavaScript.

Current [local MCP](../../../packages/doodle-note-mcp/src/local-source.ts) directly scans originals, rechecks configured consent and works with desktop closed. A vault needs a separately authorized unlock broker/protocol, bounded capabilities and revocation; do not give MCP a reusable key or auto-unlock on a search. Locked access must return a specific unavailable/locked state. Existing plaintext-library MCP can keep its current explicit consent contract. The decision whether a future broker may run with desktop closed remains open for product review.

Exports require an unlocked source, a chosen destination and a clear plaintext outcome. Cloud processing and sync still require their independent consent and source-export authorization. Neither an unlocked vault nor `sourceScope` grants cloud permission. Index rebuild, recipes, retrieval and citations must fence library/scope/revision changes and lock transitions.

## Migration, missing media and compatibility

Future migration must be opt-in, copy-first and restartable: quiesce all writers; inventory and hash raw bytes; check destination identity and capacity; encrypt into a separate staging location; authenticate and byte-compare restored content; verify independent recovery; then atomically activate a versioned configuration. Preserve original paths/bytes until the user separately chooses retention/deletion. Account for peak space for originals, staging and recovery copies. Concurrent external edits must abort or restart validation.

Cancel, crash, power loss, disk full and removal of the destination must leave a known valid original or committed vault. Never initialize a replacement library when the configured volume is missing. Persist enough state to distinguish incomplete staging from an activated vault and never resume against a different volume merely because its path matches. Deletion of redundant plaintext cannot guarantee removal from SSD history, snapshots or backup services.

Rollback before activation selects the unchanged originals. After editing in the vault, reverting to old originals would discard new work: require a verified export into a new plaintext location with explicit disclosure, version conflict handling and retained ciphertext. Old clients must not be allowed to write an encrypted library as if it were empty. Current JSON readers skip unreadable/unrecognized files, so repointing their paths is unsafe. Keep a distinct format/location and enforce supported-reader versions before changing configuration. Downgrade, companion/mobile, MCP and external-writer behavior need a concrete compatibility matrix.

[DEV-289 mobile encrypted archives](../../../apps/mobile-native/docs/encrypted-archives.md) are a separate backup format and lane, not a desktop live-vault implementation. This decision neither changes that format nor claims interoperability. DEV-359 relocation is an existing copy/recovery precedent; DEV-483 cloud audio retention is not authority to delete local originals during encryption.

## Bounded experiment and results

Run from the repository root with Node 22+; no dependency installation is needed:

```sh
node --test docs/research/dev-512/probe.test.mjs
git diff --check
```

`probe.mjs` uses Node's AES-256-GCM primitives with random keys/nonces and binds the experiment version, library and entry role as authenticated data. Decryption returns data only after authentication. The primitive API is documented in [Node 22 crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html). Files are clearly marked disposable; production code does not import them.

The fixture contains synthetic UTF-8 JSON with an unknown future field and small arbitrary binary sequences named audio/attachment. These are **not playable media**. The test runner owns unique OS temporary directories and removes them afterward; it never opens a personal library. Only synthetic recovery material is passed through subprocess stdin, not command arguments. No external sends occur.

Observed on 2026-10-17 with Node `v24.22.0`: **7 tests passed, 0 failed, 0 skipped**. No application/store/MCP modules are imported, so package builds and compatibility suites were not needed for this standalone research artifact. Native and second-device checks remain unperformed.

| Experiment | Expected observation |
| --- | --- |
| Device and independent recovery unwrap | Every original byte preserved, including Unicode and unknown JSON fields |
| Fresh process, separate directory, no device envelope/key | Recovery secret plus copied ciphertext restores the same bytes |
| Missing/wrong key or wrong wrap role | Error; no returned plaintext |
| Changed ciphertext/tag, library or entry role; unsupported version | Authentication/format error, no result |
| Over 1 MiB per entry | Explicit experiment size error |
| Cancel before staging, absent destination, existing target | No original modification; no fallback directory creation; no target overwrite |

This demonstrates the separation of portable recovery from device unlock and a small copy-first failure matrix. It does **not** prove production cryptographic correctness, crash-atomic migration, large-file streaming, secret zeroization, usable recovery UX, real OS keychain behavior, native audio capture, real removable-media failure or old-client enforcement. The staging helper has no activation protocol, fsync journal or mid-write recovery and must not be reused for migration. Random per-envelope nonces in tiny fixtures are not a production key/nonce-lifetime analysis. The fresh-process check is not a second-device/platform test.

## Separately scoped implementation acceptance

Before implementing a vault, require:

1. Accepted threat model, plaintext/metadata exclusions, recovery experience, lock policy and offline MCP policy; independent design/cryptography review of a versioned bounded parser, integrity/completeness/rollback rules, streaming and key lifecycle.
2. Complete reader/writer registry and platform design covering live native capture, ASR staging, caches/journals, protocol media, generated artifacts and logs. Unsupported platforms fail explicitly; no insecure key-storage fallback.
3. Synthetic plus native fault matrix for wrong/missing/revoked keys, cancellation, source changes, disk full, process kill/power loss, removed/replaced media, interrupted rekey and concurrent old clients. Originals and manual corrections remain recoverable and byte-preserved.
4. Verified restore on a separate device without original keychain/account; large real-format audio playback, richer records and attachment recovery; downgrade and rollback without silent loss. Recovery secret UX and accessibility receive human QA.
5. Exact release evidence for signed installed clients, lock/unlock/capture transitions, MCP revocation and cloud authorization. Performance/space limits and backup guidance are measured and disclosed.

DEV-512 can complete when the human accepts this report and experiment limitations. No production vault, migration, release, E2EE or security certification is delivered by this PR.
