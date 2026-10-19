# Cited local library answers (DEV-507)

Cited Ask retrieves original personal-note lines and transcript segments across the eligible local library, including old meetings and late details missing from summaries. It runs only on a cached local notes model even if global Settings selects a cloud provider. There is no automatic download, provider fallback, cloud Fetch execution or prior-chat grounding.

Production rollout is **off**. A development override requires an unpackaged build, `DOODLE_CITED_ASK=1` and an explicit isolated `DOODLE_USER_DATA` path. Do not point QA at an existing personal profile. A development launch is not packaged macOS or Windows qualification. [Acceptance evidence](qa/dev507/quality-rubric.md) keeps retrieval, real model wire, human semantics, responsiveness and native media/lifecycle gates separate.

## Evidence and coverage

Original JSON/audio remain authoritative. Local source scope has null account/workspace independently of sign-in; the canonical source-library marker supplies identity. Existing v1 source IDs and projected revisions are unchanged. Corrected participant labels, selected-summary changes, uncited edits, new eligible originals, scope/path changes and consumer request changes invalidate prior evidence. No original is rewritten by retrieval, validation, viewing or playback.

A complete requested-source scan is required before inference and every non-error answer, including no-history and insufficient-evidence. Unknown/unreadable eligibility fails closed. Explicit `[]` selects no history; it never widens to the library. Known date/folder-excluded unavailable units do not poison the narrowed domain. Unknown dates are disclosed. Scan completeness does not imply semantic completeness.

Question mode uses deterministic case/diacritic-insensitive lexical terms and phrases, with a 16-term/4-phrase plan, 1,600-code-point windows, 64 candidates, 24 selected ranges and 4 per meeting. It is not synonym search or a semantic census. Linked-history mode samples head/middle/tail and optional topic matches from an explicit trusted subset. Selection and model-budget omissions are visible even after a complete scan. Separate literal census counts use all eligible originals, disclose unavailable/changed units and show at most 100 meetings. Changed contributions are removed from partial lower bounds.

The local adapter budgets the actual allocated context, native tokenizer and resolved chat wrapper, including system/question/context/coverage/schema metadata and 4,096 output plus 256 safety tokens. Shortening stays on Unicode boundaries, keeps match-centered original offsets and produces distinct authorized range IDs. Only exact wire-included IDs can support up to 12 claims with 1–4 citations each. Membership/schema validation does not establish factual support; independent human scoring is required.

## Ownership and invalidation

One main-owned `CitedAskService` owns model/producer admission and no persistence. Home and calendar consumers own independent cache/history and current-request/owner fences. All non-error snapshots carry a request digest of the normalized full descriptor: fixed purpose/selection/context keys, exact question/event text/topic, sorted deduplicated subset, normalized UTC dates and consumer revision. Omitted subset differs from `[]`. Missing historical digests are invalid, never synthesized on read.

Cancellation retains shared worker/model and LibraryActivity ownership until acknowledgement or retirement. The cited-only `resolveAcknowledged` path does not change the legacy resolve API. Validation rereads current originals after asynchronous resolves and after audio mapping; it is an observed freshness fence, not an atomic filesystem snapshot or a guarantee against later external edits. Failed post-generation admission saves nothing and preserves prior history.

Host invalidation aborts the shared producer first, then synchronously calls isolated listeners. Listeners retire display/cache and abort their own operations synchronously. Returned listener Promises are observed for rejection but not awaited; host completion means shared producer cleanup, not consumer disposal. Consumers retain their own cleanup/activity fences and do not recursively invalidate the host. Unsubscribe is idempotent; synchronous recursion is suppressed and repeated external invalidations notify again.

## Home compatibility and source navigation

Home history remains an array in the existing file. Atomic private temporary writes, fsync and rename preserve unknown fields; corruption or unsupported richer content blocks destructive writes. Clear/storage epochs prevent late appends. Cited entries store only a generic safe fallback for older readers; current renderers validate before exposing claims. Legacy entries say sources were not recorded and never enter new inference. Failed save is explicit; no persistence success is implied.

The shared original panel displays exact read-only text and the canonical speaker, highlights original UTF-16 offsets, labels date fallbacks and restores focus to the citation button. Playback requires the original segment's absolute timing wholly inside one persisted recording part. Missing/corrupt timing, missing overlapping recordings, imported text, ambiguous choices, historical channel-save failure, symlinks or changed originals/files disable it. No selected-part or directory-timestamp guess is used. Opaque capabilities expire after five minutes and are bounded to 128; consumers validate current request and owner before and after reading bytes. Native media decoding, audible seek and device capture require separate QA.

## Privacy and rollback

Evidence, history and derived indexes contain sensitive original text; none is encryption at rest. Read-only local MCP shares the same evidence and census contract without SQLite/model work or identity writes. Hosted tools are unchanged. Rollback reverts code and leaves original JSON/audio/identity intact. Optional cited history remains safe generic text to older readers, and unknown richer data must be preserved. Do not delete originals or reset library identity to clear a cache.

Human/CODEOWNER review, exact final stack checks and macOS qualification precede rollout. Windows native QA follows. A green software test or successful build is not release, packaged-runtime or human-semantic acceptance.

Current measured results: [native wire and failed/incomplete answer quality](qa/dev507/native-results.md), [responsiveness and remaining relative failure](qa/dev507/performance.md), [software checks](qa/dev507/software-checks.md), [isolated renderer checks](qa/dev507/visual-checks.md) and [bounded independent reviews](qa/dev507/review-ledger.md). These evidence boundaries are required before any rollout decision.
