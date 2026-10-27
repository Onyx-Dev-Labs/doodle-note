# Hosted macOS GUI session preflight

This is a bounded **session prerequisite report**, not GUI or updater acceptance.
It never downloads an artifact, launches DoodleNote, builds/signs an app, acquires
models, captures audio/screens, changes permissions/trust/DNS, or drives native UI.
Even all-positive probes exit **2 (BLOCKED)**. A green unit test run is fixture
coverage, not observed hosted behavior. Both parent-executed hosted runs below
remain BLOCKED; the corrected run observes session prerequisites only.

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
  ConsoleUser is projected to its top-level Name/UID before output truncation;
  nested sessions are discarded. Schema 2 records unknown login matches as
  `null` with a parse-evidence reason, rather than an observed mismatch (`false`).
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
  and reap state; generic returned probe text is limited to 512 characters. The
  ConsoleUser parser examines at most 65,536 characters and returns only Name
  (maximum 128 characters), UID (maximum 10 digits) and a fixed evidence reason.
  Oversize, malformed, duplicate or missing fields leave the match unknown. Raw
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

The parent exercised this route at both exact implementation heads recorded below.
This evidence update does not authorize or perform another dispatch.
Record the resulting run's `head_sha` and compare it with the reviewed PR head
before attributing evidence. No artifact/candidate inputs are needed. Expect a
failed job with exit 2, and artifact `hosted-mac-gui-session-<run_id>` containing
`result.json`; all-positive session prerequisites are `observed` while
`gui_availability` remains `unestablished`, and app/updater remain `unperformed`.
If checkout/runner provisioning fails before the script, no report exists: that
is infrastructure failure, not negative or positive GUI evidence.

## First hosted evidence and offline parser correction

Parent-dispatched [run 40543893127](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/40543893127)
at `01a5dac2bfc8a5dba631c189f8d6c965c44aa7eb` exited 2 as designed. Parent reports
candidate/release and verify-existing jobs skipped. The retained report at
`/tmp/doodlenote-hosted-session-40543893127/result.json` was read in full and left
unchanged (SHA256 `d8d57788b12704b29ddeaccfc869f308e296f8d5332483f40aae4eb8f7d15e02`).
It records actual macOS 15.7.9 / 24G830 / arm64, image 20260907.0337.1, GUI
bootstrap present, WindowServer PID 155, probe and console owner UID 501,
login name runner, absent default profile, clear checked launch variables, and
all 15 owned probe processes exited 0 and were reaped. App/GUI/updater remain
unperformed/unestablished.

Its `login_uid: null` does **not** prove a login mismatch. That revision truncated
all command output to 512 characters before searching for UID. Apple's
[ConsoleUser implementation](https://github.com/apple-oss-distributions/configd/blob/585b7f2fca293f4642d21d15c5daf187f63c4796/SystemConfiguration.fproj/SCDConsoleUser.c)
defines root Name/UID separately from SessionInfo. The
[SCPrint formatter](https://github.com/apple-oss-distributions/configd/blob/585b7f2fca293f4642d21d15c5daf187f63c4796/SystemConfiguration.fproj/SCD.c)
sorts dictionary keys and indents nested collections by two spaces; scutil's
[show command](https://github.com/apple-oss-distributions/configd/blob/585b7f2fca293f4642d21d15c5daf187f63c4796/scutil.tproj/cache.c)
prints that structured value. SessionInfo can therefore push root UID beyond
the limit. An offline synthetic two-session fixture is 691 characters, with
root UID at offset 677: the real probe transport (mocked subprocess) reproduced
`501` becoming `null` before the fix and correctly returns `501` after it.

The original raw stdout was intentionally not retained, so this is a reproduced
instrumentation defect and plausible explanation, **not proof of that run's
missing-UID cause**. Preserve its original report; interpret console-login match
as unknown. Do not retrofit a pass. Schema 2 parses before truncation, keeps only
root fields and parse status, and excludes nested identities. No native commands,
new dispatch, app launch, signed-byte changes or environment changes were used
for the correction itself. The subsequent parent rerun supplies separate evidence
below; it does not alter the original run's unknown login match.

## Corrected hosted session evidence (2026-10-27)

After full review of exact `c3508e3e3eda935fa37135d579e51898311e151c` and rerunning
14 Python tests plus 6 Ruby tests / 59 assertions, the parent dispatched
[run 40545214783](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/40545214783)
at that head. It completed with the expected **BLOCKED exit 2**; the parent
reports release and verify-existing jobs **SKIPPED**. The complete downloaded
`/tmp/doodlenote-hosted-session-40545214783/result.json` was read, with SHA256
`1e9b1705b22fecccda96ae9ef56e1abca03e386e6ba736ecdde79cb74e75e62c`.

Schema 2 records macOS **15.7.9 / 24G830 / arm64**, image **20260907.0337.1**,
all eight prerequisites true, probe/console/login UID **501**, login name
**runner** with evidence **parsed**, and WindowServer PID **160**. All 15 owned
probes exited 0 and were reaped without timeout. `session_prerequisites` is
`observed`; `gui_availability` remains `unestablished`, and visible window,
actual app, updater, artifact acquisition and model acquisition are `unperformed`.

Scope is strictly `hosted-session-prerequisites-only`, not usable GUI or updater
acceptance. A usable remote **CUA route to the guest** and reviewed
**pre-staged-model/no-download planning** remain unresolved. Both original
reports and signed bytes remain unchanged; the first run's login match stays
unknown. This record-only update adds no implementation, probes, dispatch,
app/model activity, network-policy changes or UI work.

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
