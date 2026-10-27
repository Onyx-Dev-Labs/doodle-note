# Hosted macOS GUI session preflight

This is a bounded **session prerequisite report**, not GUI or updater acceptance.
It never downloads an artifact, launches DoodleNote, builds/signs an app, acquires
models, captures audio/screens, changes permissions/trust/DNS, or drives native UI.
Even all-positive probes exit **2 (BLOCKED)**. A green unit test run is fixture
coverage, not observed hosted behavior. No hosted dispatch was performed while
preparing this implementation; actual OS/build/architecture remain unobserved.

## Scope and runner

The `gui-session-preflight` operation uses explicit `macos-15`. GitHub's official
[standard runner table](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories)
lists this label as **ARM64**, with a fresh VM per job. This is not an inference
from the OS version. Verified 2026-10-27 against that table and the current
[runner-images API](https://api.github.com/repos/actions/runner-images/contents/images/macos/macos-15-arm64-Readme.md):
README blob `9aebcc7d1671af9c76f803da2c2ef5c6c058a1e8` advertises macOS
15.7.9 / build 24G830 / image 20260907.0337.1. These are catalog values, not this
probe's results. The job records actual `sw_vers`, `uname`, `ImageOS` and
`ImageVersion`; mismatching OS family or architecture leaves prerequisites
incomplete. It cannot qualify macOS 14, whose official
[retirement notice](https://github.com/actions/runner-images/issues/13518) specifies
2026-11-02.

The separate `hosted-mac-gui-session-preflight.py` script:

- Refuses native probes unless the process is on macOS with Actions' hosted-runner
  markers. This guard prevents accidental local execution; it is not attestation
  against someone deliberately forging environment variables.
- Records console owner and `scutil` console login, compares them with the runner
  user, queries `gui/<uid>` bootstrap existence, and records WindowServer PIDs.
  These do **not** establish a visible, usable display or responsive app window.
- Queries only named Node/Electron/dynamic-loader launch variables. It retains
  presence flags, never their values; the bootstrap domain dump is discarded.
  Query failure is unknown/incomplete, not a clean launch environment. It does
  not repair the environment or change LaunchServices configuration.
- Checks only the default guest profile path's existence and whether HOME equals
  the runner account's default home. It never opens profile contents or creates
  a synthetic library. An existing profile is an incomplete freshness prerequisite.
- Uses allowlisted subprocess environment, absolute executable paths and no shell.
  Each read-only probe has 3 seconds, then kills only its own child and allows
  1 second to reap it. A failed reap is explicitly recorded; no global process
  kill or service cleanup occurs. Normal exits record PID, exit code, duration
  and reap state; retained probe text is limited to 512 characters, and raw
  stdout/stderr are not included in evidence. The script step has a 2-minute
  timeout inside a 5-minute job. Only `result.json` is uploaded, including on
  blocked/failure exits, with 14-day retention.

The job has only `contents: read`, checkout does not persist credentials, and no
download token or secrets are supplied. This is narrower than existing
`verify-existing`'s `contents: read` / `actions: read` artifact acquisition
permissions: session-only work needs no Actions artifact read permission.
GitHub's evidence uploader runs separately from the probe process.

## Dispatch route for parent review

A new workflow with only `workflow_dispatch` would require default-branch
registration. GitHub documents both that requirement and
[dispatching a registered workflow using `--ref`](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Therefore the only release-workflow change is an additive choice and isolated
job in the **existing** `.github/workflows/mac-release.yml`. Candidate and
verify-existing jobs, defaults, inputs, concurrency and permissions are preserved.

Read-only API checks on 2026-10-27 verified registered workflow ID **343291536**,
path `.github/workflows/mac-release.yml`, state `active`, default branch `main`,
and a `workflow_dispatch` trigger in main's file (blob
`b9a4da27cd55cf0189031ecd09e54623a2340b44`). Main still contains the old publishing
workflow. **Never dispatch main or omit the explicit branch/operation.** The new
job also rejects main and tag refs. No registration of a new workflow is needed.

After reviewing the exact PR head and confirming the remote branch still names
that head, the parent can dispatch the pushed, unmerged branch with:

```sh
gh workflow run 343291536 --repo Onyx-Dev-Labs/doodle-note \
  --ref t3/hosted-gui-session-preflight \
  -f operation=gui-session-preflight
```

This command is a prepared route, **not executed dispatch evidence**. Registry
and ref support are verified by API/docs; actual scheduling remains untested.
Record the resulting run's `head_sha` and compare it with the reviewed PR head
before attributing evidence. No artifact/candidate inputs are needed. Expect a
failed job with exit 2, and artifact `hosted-mac-gui-session-<run_id>` containing
`result.json`; all-positive session prerequisites are `observed` while
`gui_availability` remains `unestablished`, and app/updater remain `unperformed`.
If checkout/runner provisioning fails before the script, no report exists: that
is infrastructure failure, not negative or positive GUI evidence.

## Later actual-updater requirements

The full 2026-10-27 audit at
`/tmp/doodlenote-0435-upgrade-release-audit-20261027.md` remains the parent plan.
This implementation starts from exact source
`89e28173363fa1263156096d42df8a9baeac7bea` and does not modify signed bytes.
Candidate reference only: signing run `39465345574`, artifact `12286705685`,
archive SHA256 `792d571f5bd89c1ac73d4b04dc169e114e5f4c5aac245088c6644b7fe080c736`,
expiry 2026-11-03. The read-only retained package is
`/Users/sean/Desktop/DoodleNote-Test-0.4.35-p6oo0x_e/package`.
None of it is downloaded or opened by this probe.

Before launching an unchanged signed app, resolve the unconditional ASR
`preflight --models-only` and subsequent engine startup in
`apps/desktop/src/main/index.ts`: model availability, network isolation and the
no-download/no-inference constraints must have a concrete, reviewed solution.
This probe does not assert that a default hosted VM satisfies them. No debugger,
injection, sandbox bypass, AppleScript/JXA/CGEvent driver or alternate remote UI
transport is introduced. Parent-owned CUA must establish a supported route to
observe and operate the actual guest GUI; hosted session probes do not provide it.

Actual acceptance still requires the verified published 0.4.33 baseline and exact
signed 0.4.35 payload; the guest's default synthetic profile (no personal mounts,
accounts or credentials); a separately authorized guest-only HTTPS fixture for
the baked production hostname with valid trust across relaunch; visible app UI;
the existing update and Restart-to-update flow; verified download bytes, native
installation, old-process exit and automatic new-process relaunch; new version,
signature and same-profile synthetic-library preservation; normal reopen and
bounded cleanup/evidence. Manual replacement/relaunch and WindowServer presence
cannot pass that gate. Publication, TCC/capture, inference, VoiceOver and broader
OS qualification remain separate.

## Fixture verification

```sh
python3 -m unittest discover -s apps/desktop/scripts -p 'test_hosted_mac_gui_session_preflight.py'
ruby apps/desktop/scripts/test_hosted_mac_gui_session_workflow.rb
ruby apps/desktop/scripts/test_mac_verification_workflow.rb
```

The Python tests mock all native commands, UID/account/profile queries and timeout
behavior. They are safe on the development host and cannot count as hosted GUI
evidence. The new tests also run in ordinary Linux CI.
