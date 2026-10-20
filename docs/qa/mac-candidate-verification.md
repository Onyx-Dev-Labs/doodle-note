# Verify an existing signed Mac candidate on macOS 14

The `verify-existing` operation of `.github/workflows/mac-release.yml` executes a bounded runtime subset on the standard `macos-14` ARM64 runner. It never rebuilds, signs, publishes, installs dependencies or downloads models. The default `candidate` operation remains the macOS15 signed/notarized, artifact-only build. The two operations use different concurrency groups and cannot cancel one another.

Use the reviewed integration branch explicitly. Do not dispatch current main: its older workflow still publishes. This verification operation refuses `refs/heads/main`. The workflow already exists on main, so a reviewed branch revision can be selected without registering a second workflow. Parent approval of the actual patch precedes any dispatch.

## Exact identity required

The manual inputs are `operation=verify-existing`, `candidate_run_id`, `candidate_artifact_id`, `candidate_sha`, `candidate_version`, and `expected_archive_sha256`. Obtain the archive SHA256 from the artifact metadata for the exact reviewed signing run. Never select a moving branch head, newest artifact or latest successful run. The workflow's `github.sha` identifies the harness separately from the candidate receipt's source SHA.

`apps/desktop/scripts/verify-existing-mac-candidate.py`:

1. Requires actual macOS14 ARM64 and validates all input formats.
2. Verifies repository, successful manual release run, workflow path, source SHA, artifact name/ID/run/repository, expiry, size and digest before download. GitHub API authorization is not forwarded to storage redirects.
3. Checks the downloaded archive hash, validates every outer member before extraction, rejects missing/extra files, traversal, symlinks and special entries. Inspects the inner app ZIP's paths, expansion size and framework links before `ditto`.
4. Reads the original receipt without rewriting it; verifies source/version/team and all payload SHA256 hashes, then manifest paths/sizes/SHA512. Verifies app/DMG signatures, expected team, tickets, Gatekeeper, bundle identifier/version and ZIP/DMG app-tree equality before candidate execution.
5. Executes synthetic audio import/merge and packaged Electron Node-mode native/worker/MCP checks, with isolated temporary HOME/config/cache/originals. Candidate subprocesses receive no workflow/signing/cloud credentials. Timeouts kill their process group; protocol failures are failures, not skips. Mounted DMGs and child processes are cleaned up by their owner.
6. Rechecks bundle inventory/signature and original payload hashes. Writes `result.json` with both source identities, run/artifact/version/hashes and exact results. The workflow uploads only this report and `commands.log`, including on failure. It never publishes the retained candidate or synthetic library.

Local unit checks (no candidate execution):

```sh
python3 -m unittest discover -s apps/desktop/scripts -p 'test_verify_existing_mac_candidate.py'
node --test apps/desktop/scripts/mac-candidate-runtime-smoke.test.cjs
ruby apps/desktop/scripts/test_mac_verification_workflow.rb
ruby apps/desktop/scripts/test_mac_release_manifest.rb
```

These also run in regular PR CI. Archive tests reject traversal, collisions, special files, unsafe links and expansion limits. Process tests exercise real child failure, timeout and cleanup. Artifact identity, hash, receipt and execution-order tests fail closed. The pure-wrapper core tests remain a separate AI suite.

## What a green runtime job means

- Packaged `engine prepare-batch-audio` accepts synthetic mono/stereo WAV and audio-only MP4, emits the expected channel protocol, and produces non-silent 16kHz PCM with bounded duration. Original inputs are unchanged.
- Packaged `engine merge-audio` exports synthetic CAF checkpoints into decodable two-channel AAC with the expected completion protocol; corrupt-only checkpoints fail and remain available.
- Packaged Electron loads its bundled Metal native addon and SQLite FTS5 without a model. The exact ASAR worker passes ready/search/resolve/stale/cancellation/scope-refusal and original-byte checks.
- The exact bundled MCP CLI passes stdio initialize/tools/search/resolve/participant-correction/stale/revocation and original-byte checks.

It does **not** qualify GUI launch, capture, TCC/keychain, VoiceOver, disk-full live UI, model inference/accuracy, CPU-only inference or the real updater. Audio-only MP4 acceptance does not prove the video-track normalization fallback; that remains a separate case. Loading a Metal addon does not prove GPU inference. Electron's Node version does not prove the MCP minimum Node18 contract; retain separate exact-bundle Node18 evidence. No claim that every catalog model or all macOS14 behavior is qualified.

The macOS14 standard runner is currently 3-core M1 / 7GB; no larger paid or self-hosted runner is required for this subset. It retires November2, 2026 and has scheduled brownouts. A brownout/queue failure is infrastructure unavailability, not a candidate pass. Record the actual runner OS/build and artifact expiry before scheduling. [Runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [deprecation and brownouts](https://github.com/actions/runner-images/issues/13518), [manual branch selection](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Historical fixture identity

The bbb352b artifact remains useful for validating this harness, but cannot qualify changed source:

- Candidate `bbb352bd96fc60b504ecf73793f6ea4564c54d16`, version0.4.33.
- Signing run39154686781, artifact12146553411, expires November1, 2026 at18:43:37UTC.
- Archive SHA256 `28e633e3f7d20cc96ae9e30006cb06904b6b5c9dcd1fdb69910aa12e367deeb3`.

It has different bytes from published0.4.33 and must never overwrite those public artifacts. A source/version correction requires fresh signing and exact new-artifact validation for final release. The publication script's overwrite/retry concerns and PR209's0.4.34 supersession remain separate parent-owned release gates.
