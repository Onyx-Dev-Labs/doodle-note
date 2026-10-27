# PR239 publisher review corrections

Reviewed head: `20a360f1af5f04a46d070fc7106732b3f92d4463`, retained locally at
`t3/safe-release-publisher-reviewed-20a360f`. Candidate/base remains
`89e28173363fa1263156096d42df8a9baeac7bea`. These corrections change only publishing
tooling, tests and documentation; they do not rebuild or modify the candidate.

Two unique findings were reproduced before changing the implementation:

1. **Local final-read/rename race** (Spec P2 and Standards F1, deduplicated).
   A deterministic writer edited the static manifest after the final read had
   captured old bytes. Activation succeeded and the unconditional rename
   overwrote the edit. The regression failed with candidate YAML where the
   concurrent edit should have remained. Activation now leaves the static path
   untouched and returns a unique `stagedManifest` proposal under the rollback
   directory. Both the final-read interleaving and an edit during remote
   activation pass; historical backups and the proposal remain separately
   inspectable. Manual reviewed replacement/deployment is now required.
2. **SDK deadline includes uncancellable retry delay** (Spec P2).
   Locked Blob 2.8.0 kept waiting after a 100 ms timeout. The new regressions failed
   before the fix: 1204 ms past cancellation for a request awaiting its response,
   and 1756 ms past cancellation after a 503 had initiated retry backoff.
   Each SDK put now has an owned worker. Deadline cancellation requests
   `AbortError` cancellation and terminates/awaits the worker, including its
   request and retry timers. Only then may the publisher settle or remove its
   snapshot. No timeout starts a further outer upload or activation attempt.

The loopback regressions use the installed SDK, fabricated credentials, and
synthetic bytes. They cancel 100 ms after the peer receives the complete body,
cover both no acknowledgement and a 503 response, require peer closure, and keep
the peer available for another 2.2 seconds to detect later writes. In the focused
final run both returned 1 ms after cancellation, with one request and confirmed
closure. These are observed local results, not a hard real-time scheduling SLA.
A pre-aborted signal starts no request. A synthetic lost manifest acknowledgement
retains old/candidate evidence and reports that Blob may already be active; no
verified static proposal is returned on that failed run.

## Evidence retained for the parent

Original reports and exact probes remain unchanged:

- Spec: `/tmp/pr239-spec-review-_0rvv3z3/report.md`,
  `probe-local-race.mjs`, `probe-sdk-timeout.mjs`, and their original output files.
- Standards: `/tmp/pr239-independent-review-OiTe4C/report.md`, `probes.mjs`, and
  `probes.log`. Its local-race finding is the same finding as Spec F1.
- Copies of both reports and exact probe sources, plus the new fail-before/pass-
  after outputs, are retained in `/tmp/pr239-fixes-20a360f`:
  `local-race-red.txt`, `local-race-green.txt`, `sdk-deadline-red.txt`,
  `sdk-deadline-green.txt`, and `focused-tests.txt`.
- Parent's prior real-candidate dry run remains
  `/tmp/doodlenote-publisher-parent-dry-run-20261027.json`. It qualified the retained
  bytes at the reviewed head; this follow-up uses synthetic inputs only.

Focused gates: 37 publisher + 8 packaging tests passed (45 total, no skips),
including locked-SDK retry/header and deadline probes. Existing Ruby manifest
checks, desktop Node typechecking, focused ESLint, formatting and whitespace
checks also passed for this patch. No broad desktop/native/model suite is claimed.

The unchanged post-write wrong-store rejection is not pre-write destination
validation and was not counted as a new finding by either review. Windows,
receipt/immutable/public-byte validation, source89 and signed artifacts are
unchanged. Blob/static deployment is still non-atomic; remote completion before
cancellation remains ambiguous. See [publication/recovery instructions](mac-publisher.md).
Fresh independent verification is parent-owned; no reviews were launched here.
