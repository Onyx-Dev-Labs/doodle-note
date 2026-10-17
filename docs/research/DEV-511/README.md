# DEV-511: speaker-observation research

**Decision proposed, not accepted: no-go for production automatic names in the macOS weekend release.** Keep channel labels and manual corrections. Go only for a separately consented, bounded native feasibility test after Sean chooses the meeting app. This PR delivers an app-independent synthetic metadata replay and report; it does not implement an adapter, run diarization, or validate a real meeting.

[DEV-511](https://app.notion.com/p/3fcf0f846ee48140b0b0e65f4f6cc701) remains In Review with Verification In progress after PR handoff. Sean owns acceptance; Alec's CODEOWNER review is expected. The required consented three-person native test is **unperformed**, not satisfied by this replay. No app choice or native-test consent was received during this research. Zoom Workplace on macOS is the **unaccepted candidate** discussed below, not a selected supported platform.

## Scope and source reconciliation

Source baseline: `origin/main` at `b53c078685b00d901a321192e886574ff0c17701`, freshly fetched October 17, 2026. The exclusive `t3/dev511-speaker-replay-research` branch started at inherited `43f4850` with no unique commits and a clean tree, then was rebased empty onto main. Vault docs are excluded. Only this directory changes; the root release helper, sibling lanes, shared types, lockfile and production code are untouched.

Read sources at that baseline:

- [speakers.ts](../../../packages/meetings-store/src/speakers.ts), its full tests and [types.ts](../../../packages/meetings-store/src/types.ts): channel-derived `self`/`far`, You/Them defaults, manual rename, self-profile precedence, and persisted participant labels. The current `confidence` field is not evidence that a proposed UI match is calibrated.
- [calendar-api.ts](../../../apps/desktop/src/shared/calendar-api.ts): provider/account/occurrence identity, organizer and `hasParticipants`; no full attendee roster in `CalendarEvent`. This contract alone cannot establish who spoke.
- [Mobile speaker evaluation](../../../apps/mobile-native/docs/speaker-evaluation.md): anonymous diarization and optional voice matching are separate; its thresholds remain uncalibrated and physical qualification is open. No mobile code or models are imported here.
- CONTRIBUTING, package scripts, CI and CODEOWNERS: Node 22+, narrow relevant checks, preserve local-first behavior. No applicable root/ancestor/docs AGENTS.md was found; the repository's web-only AGENTS.md does not govern this directory.

Live Notion issue/project/schema and complete related histories were read before edits. DEV-114/ONY-83 is Done and [#63](https://github.com/Onyx-Dev-Labs/doodle-note/pull/63) merged; its sole-attendee scope must not be expanded into multi-person identity. DEV-271/ONY-246 [#149](https://github.com/Onyx-Dev-Labs/doodle-note/pull/149) merged but the issue remains In Review for physical mobile QA. DEV-256 [#200](https://github.com/Onyx-Dev-Labs/doodle-note/pull/200) and DEV-374 [#201](https://github.com/Onyx-Dev-Labs/doodle-note/pull/201) remain open Windows lanes; their synthetic source tests are not independent-speaker accuracy. None is taken over or edited.

## Identities and proposed research contract

An **attendee identity** is a roster/invite record. Invitation does not prove attendance; display names can collide or change. A meeting-app participant ID is scoped to that app and meeting, and reconnect may replace it. A room endpoint can represent several people. An **audio channel** is a capture source, such as mic or system mix, not a person. An **acoustic cluster** is an anonymous model grouping within a diarization session; it need not match a channel, attendee or previous session's cluster. There is no acoustic clusterer in this probe.

A **UI observation** is a timestamped report of which app participant(s) appeared active. It is evidence about an app's state, not ground truth about the audio. Dominant/pinned video, activity animation and actual concurrent speech can differ. A single highlighted participant cannot prove absence of overlap.

The standalone input uses meeting/session/source-revision scope; stable segment IDs with capture-relative intervals; observation ID, observed and received timestamps, status, active participant IDs; explicit time-bounded participant-to-attendee bindings; clock offset/uncertainty; and scoped manual corrections. All names are fictional Ada, Bo and Cy. `truth` is passed only to scoring, never to `replay`. Bindings are supplied fixture assumptions, not name matching or a validated identity resolver. No calendar roster is treated as proof.

For a future reviewed contract, additionally bind every result to library/account and adapter instance/connection generation, app version and consent epoch; persist evidence references and user acceptance separately. This disposable probe does not implement an account/library or adapter lifecycle. Its session and source-revision tests model only part of those boundaries. Never pass a suggestion directly into today's `MeetingParticipant` or transcript label: downstream summaries, exports and synced readers currently interpret such labels as established names.

Manual corrections are segment-scoped and win over both replay methods. An explicit null correction means “reject naming,” which remains generic after reload/replay. A JSON disk roundtrip test proves this probe's persistence representation only, not production store/sync integration. Changing meeting, capture session, source revision or segment ID prevents reuse. A future production design needs explicit remapping review after resegmentation; copying a correction to a reused cluster number is unsafe.

## Reproduce

From repository root, with Node 22+ and no package install:

```sh
node --test docs/research/DEV-511/replay.test.mjs
node docs/research/DEV-511/replay.mjs > /tmp/dev511-results.json
cmp docs/research/DEV-511/results.json /tmp/dev511-results.json
node docs/research/DEV-511/replay.mjs --details > /tmp/dev511-details.json
/Library/Developer/CommandLineTools/usr/bin/git diff --check
```

`fixtures.mjs` deterministically generates all labeled input, including four metadata observations per second. No files, microphone, camera, screen, meeting app, network, model cache or personal library are read by the replay. It accepts no external fixture path. The test's only writes are fictional corrections under a new temporary directory, removed afterward. `results.json` is checked-in machine-readable output; `--details` exposes every label, suggestion, reason and observation ID for audit.

Local verification: 20 tests passed, zero failures/skips; deterministic replay matched checked-in results byte for byte, and diff whitespace check passed. Local environment: Node v24.22.0, macOS 26.6.2 (25G83), Apple Silicon host. These are harness-host facts; **meeting-app version: not tested**. A full app install/build, desktop/meetings-store suite, Swift build and UI screenshots were not needed or run because no production/native/UI code or dependency changed. Required hosted CI/CodeQL and human review remain separate PR gates; this standalone command is not automatically wired into the existing product CI.

## Method and limits

Each of 16 scenarios has six one-second speech segments: 96 segments total (96 segment-seconds). Two segments contain overlapping truth; these are not 96 independent participants or real speech trials. The scenario mix is hand-selected, disproportionately includes failure cases, and shares a scripted turn pattern; aggregate rates are diagnostic, not population estimates. No confidence interval, word-error rate, diarization error rate or real-world identity accuracy is claimed.

The channel-only baseline retains You/Them and the same manual correction used by the candidate. It assigns no person from a channel alone. Thus generic You is counted as unknown **person identity**, even though its channel is known. The shared-room case demonstrates why a mic label must not be counted as verified Ada. This is an isolated abstraction of channel fallback, not execution of the production resolver with all its enrichment paths.

The timestamped candidate samples each segment on a 250 ms grid. It subtracts the supplied clock offset, retains samples at most 500 ms old, requires 75% segment coverage for one participant, and abstains on observed overlap, ambiguous/unbound endpoints or any observed adapter failure. Clock uncertainty above 250 ms also abstains. Received-time gating permits at most 1500 ms settling after the segment ends. These are explicit experimental knobs, **not calibrated safety thresholds**. Event times are synthetic milliseconds; adapters must establish actual SDK units/clock semantics instead of copying them.

This is delayed segment reconciliation, not a live label/latency benchmark. It cannot observe events received after the decision deadline. Stale callbacks from other meetings/sessions/revisions are ignored. Missing observations expire. Healthy observations earlier than a simulated revocation remain historical evidence; revoked intervals yield generic labels. Detection delay, missed revocation, consent teardown and process races are not natively tested. There is no retroactive deletion of manual corrections.

The oracle variant subtracts the injected 1000 ms lag in the lag scenario. Clock offset and correct participant bindings are already supplied to both observation variants. Clean observations are generated from the scripted truth except deliberate faults. Consequently this is an optimistic **oracle-assisted plumbing experiment**, not independent evidence for extraction, diarization, identity binding or lag estimation. A misleading UI fixture deliberately disagrees with truth even with perfect timing.

False-name count means an emitted single-name candidate (manual or suggestion) does not exactly equal the complete truth set. Naming just one person in overlapping speech counts as wrong/incomplete. Report both `falseNames / named` and `falseNames / all segments`; unknown is `no candidate / all segments`. Suggested names are scored **as if accepted** to reveal prospective risk; they are never asserted by the harness. Confirmed/manual outputs are counted separately. Zero denominators yield null, not a fabricated zero rate.

## Measurements

| Method | Wrong names / named | Wrong / all | Unknown / all | Suggestions | Manual confirmations |
| --- | --- | --- | --- | --- | --- |
| Channel-only | 0 / 1 (0%) | 0 / 96 (0%) | 95 / 96 (98.96%) | 0 | 1 |
| Timestamped | 6 / 37 (16.22%) | 6 / 96 (6.25%) | 59 / 96 (61.46%) | 36 | 1 |
| Oracle lag-corrected | 1 / 38 (2.63%) | 1 / 96 (1.04%) | 58 / 96 (60.42%) | 37 | 1 |

All three have zero wrong manual confirmations out of one, and **zero automatic name assertions**. Excluding the manual confirmation, wrong suggestions are 6/36 (16.67%) and 1/37 (2.70%). A low wrong-name count obtained by withholding almost every name is not a useful-coverage success.

Timestamped per-scenario results, each out of six segments:

| Scenario | Wrong / named | Unknown / 6 | What it exercises |
| --- | --- | --- | --- |
| Clean three-person | 0 / 6 | 0 / 6 | Optimistic turn-aligned observations |
| Overlap | 0 / 4 | 2 / 6 | Multi-active intervals withheld |
| Reconnect | 0 / 5 | 1 / 6 | New endpoint requires explicit binding |
| Shared-room mic | 0 / 2 | 4 / 6 | One endpoint cannot identify its two occupants |
| Lag + clock offset | 5 / 5 | 1 / 6 | Known 400 ms offset, uncorrected 1000 ms UI lag |
| Uncertain clock | 0 / 0 (undefined) | 6 / 6 | 600 ms uncertainty fails closed |
| Stale meeting, session, revision (three fixtures) | 0 / 0 each | 6 / 6 each | Cross-scope observation rejection |
| Denied, inaccessible, failed (three fixtures) | 0 / 0 each | 6 / 6 each | Generic fallback despite cached name payload |
| Revoked | 0 / 2 | 4 / 6 | Failure begins after two healthy segments |
| Manual correction | 0 / 5 | 1 / 6 | Corrected Bo and persistent rejection beat wrong Ada observation |
| Misleading UI | 1 / 6 | 0 / 6 | Perfect timing does not establish truth |
| Missing observations | 0 / 2 | 4 / 6 | Old activity expires |

Lag sensitivity uses only the six clean scripted segments, with constant lag injected into both observation and receipt times; clock offset is zero. These rows are **not additional independent fixtures**:

| Injected lag | Uncorrected wrong / named | Unknown / 6 | Known-lag oracle wrong / named |
| --- | --- | --- | --- |
| 0 ms | 0 / 6 | 0 / 6 | 0 / 6 |
| 250 ms | 0 / 6 | 0 / 6 | 0 / 6 |
| 500 ms | 0 / 0 (undefined) | 6 / 6 | 0 / 6 |
| 750 ms | 5 / 5 | 1 / 6 | 0 / 6 |
| 1000 ms | 5 / 5 | 1 / 6 | 0 / 6 |
| 1500 ms | 0 / 0 (undefined) | 6 / 6 | 0 / 6 |

The non-monotonic curve follows one-second alternating turns and a 75% cutoff; it is not a robust lag tolerance. A high coverage value can confidently point at the previous speaker. Real variable lag, drift, packet jitter, short interjections, silence, long segments, missing overlap signals and mislabeled room endpoints still need measurement.

## Official API candidates and access costs

Sources checked October 17, 2026; these are documentation findings, not runtime verification.

**Zoom Workplace for macOS — unaccepted candidate.** Zoom's current [Plugin SDK overview](https://godevelopers.zoom.us/docs/plugin-sdk/macos/) explicitly offers IPC integration with the installed Workplace client. This is a distinct candidate from the bundled Meeting SDK; do not claim no official native integration exists. [Prerequisites](https://godevelopers.zoom.us/docs/plugin-sdk/macos/get-started/) include a Marketplace developer account, Workplace 7.0.2+ and Xcode 16.1+. [Integration](https://godevelopers.zoom.us/docs/plugin-sdk/macos/integrate/) requires OAuth scope `plugin_sdk:read:connection_meta` and re-signing SDK libraries. The inspected [Audio](https://marketplacefront.zoom.us/sdk/plugin/mac/plugin_sdk_swift_meeting_audio.html) and [Participants](https://marketplacefront.zoom.us/sdk/plugin/mac/plugin_sdk_swift_meeting_participants.html) references do not by themselves establish a timestamped active-speaker callback. The documented [ZoomToolSuiteUser](https://marketplacefront.zoom.us/sdk/plugin/mac/plugin_sdk_objc_zoomtoolsuiteuser.html) includes `bTalking`, while the inspected [event listener](https://marketplacefront.zoom.us/sdk/plugin/mac/plugin_sdk_objc_zoomtoolsuiteeventlistenerprotocol.html) lists user/meeting/IPC status callbacks without establishing a timestamped speaking-change stream. Polling that property is a candidate, not validated extraction or a claimed latency bound. Verify update semantics, roles, permission scopes and timing before choosing it. No account, registration, token, download, entitlement or connection was created here. SDK/client compatibility and access-policy changes add maintenance cost.

Zoom Apps SDK documents [onActiveSpeakerChange](https://appssdk.zoom.us/classes/ZoomSdk.ZoomSdk.html#onActiveSpeakerChange), available to Host/Co-Host and not guest mode, with a [timestamp and users array](https://appssdk.zoom.us/types/ZoomSdkTypes.OnActiveSpeakerChangeEvent.html). This applies inside an authorized Zoom App, not a general macOS observer. The [Meeting SDK integration](https://developers.zoom.us/docs/meeting-sdk/macos/integrate/) embeds SDK frameworks in your own app. Its [historical macOS delegate](https://zoom.github.io/zoom-sdk-macos/protocol_zoom_s_d_k_meeting_action_controller_delegate-p.html) documents active-audio events and a deprecated active-speaker method; do not copy its old selector as a current Plugin SDK implementation. Neither route proves observation of arbitrary third-party windows or all participant roles.

**Google Meet.** The [Media API overview](https://developers.google.com/workspace/meet/media-api/guides/overview) currently says new Developer Preview signups are closed, describes consent/start/stop controls and participant metadata, and notes media stream identity can change. The [get-started guide](https://developers.google.com/workspace/meet/media-api/guides/get-started) requires preview enrollment for the project, OAuth principal and all participants. These are service-connected API access conditions, not local browser observation. This is unsuitable for an account-free, no-cloud weekend probe. An independent browser UI/DOM adapter would require separate consent and measured browser/layout/localization maintenance; none was inspected or implemented.

**Microsoft Teams.** The [real-time media documentation](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/real-time-media-concepts) distinguishes active speakers heard in an audio frame from dominant speakers in the conversation. Its application-hosted media bots require .NET/C# and Windows Server. [Calling bot registration](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/calls-meetings-bots-overview) requires app configuration, Graph permissions and admin consent. This is a bot participating in calls, not a Mac process reading a running Teams client. Its infrastructure/permission cost conflicts with this local-only scope. Meeting participant metadata alone is not acoustic identification.

**macOS Accessibility alternative.** Apple's [AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions) checks Accessibility trust; its prompt option informs the user and does not grant permission. [AXUIElementCopyAttributeValue](https://developer.apple.com/documentation/applicationservices/1462085-axuielementcopyattributevalue) reads exposed attributes. The installed Apple `AXUIElement.h` also documents unsupported attributes, absent values, unimplemented accessibility and messaging failures. These APIs do not promise a Zoom/Teams active-speaker attribute. No app selector, AX hierarchy or polling reliability is invented here. A consented accessibility feasibility inspection could test that possibility if the explicit SDK path is unavailable; it is not an implemented fallback.

## Privacy, maintenance and native gate

The probe itself needs **no OS or meeting-service permissions**. A future Accessibility adapter would request explicit user-controlled Accessibility access only after a separate opt-in, limit reads to the chosen app/meeting, and avoid storing broad UI trees, chat, email, unrelated windows or meeting titles. It would need bounded background reads, stale-data expiry, revocation handling and version/layout/localization qualification. Accessibility metadata does not require this probe to capture screen pixels; screen recording/OCR and camera capture are excluded. Microphone/system audio permissions and participant consent would be additional gates for any audio-backed native experiment. No permission is auto-granted, and this run made no permission prompt or change.

SDK routes also need explicit app/service access and token handling. Local IPC does not prove the entire authorization flow is offline. No route may silently add cloud processing, telemetry with names, voice enrollment, a remembered-person catalog or personal-library reads. Retain only consented pseudonymous observation/timing evidence, keep it outside normal libraries, define deletion/retention with participants, and never put real recordings/identities in a public PR.

Optional local diarization was not run: no approved real speech fixture or verified model input was available in this lane. Existing mobile documentation establishes a separate explicit model-install path, not a model-free desktop engine. No model was downloaded, no personal model cache searched, and no synthetic acoustic accuracy claim is made. Diarization could supply anonymous temporal overlap evidence later; it cannot on its own turn a cluster into a name.

**Proposed next bounded native gate (requires Sean's choice and participant consent, not yet authorized or executed):**

1. Record exact app/SDK/OS versions, chip, role, access route and granted permissions. First verify a documented read-only observation surface or inspect only the consented app UI. If no stable surface exists, stop with feasibility no-go; do not invent selectors or expand scope.
2. Use three consenting testers with pseudonyms and an independent turn/reference log: solo turns, interruption/overlap, shared-room mic, reconnect/rename, lost UI, denial, mid-session revocation and app failure. Record actual timestamp units, monotonic mapping, receive delay, variable lag and drift. Include non-host roles where applicable.
3. Freeze lag estimation/thresholds on a calibration portion, then score a held-out portion with the same baseline and false-name/unknown denominators. Report failures, coverage, latency and resources per scenario; manual correction/rejection must survive relaunch. No fixture truth or manual labels may train the held-out timing correction.
4. Sean must accept an explicit risk/coverage target and decide whether limitations satisfy the research boundary. The proposed product gate is zero automatic name assertions, manual precedence, and generic fallback on unavailable evidence; no numeric real-world false-name or coverage target is accepted yet. Human review cannot be replaced by these synthetic totals.

**Go/no-go:** proceed with report review and, only after selection/consent, one Zoom native feasibility experiment. Prefer verifying the explicit Plugin SDK capability/access contract before fragile UI extraction; keep Accessibility as a separately consented contingency, not automatic fallback. No-go for production speaker identity, broader platform promises or weekend accuracy claims on present evidence. Removing this directory reverses the research artifact without changing product behavior or migrating data.

## Acceptance and handoff

- Distinct identities, overlap/reconnect/room/lag cases and denominators: documented and replayed.
- Denied/revoked/inaccessible/failure fallback, stale scopes and correction precedence: synthetic regression evidence only.
- Reproducible measurements, privacy map and proposed decision: delivered for review. Checked-in results are asserted by a reproducibility test.
- Required native three-person experiment, app choice/access, calibrated thresholds, human acceptance and PR CI/review: outstanding. No required limitation is treated as accepted merely because it is written here.

Check this: run the commands above; tests should pass and `cmp` should print nothing. In `--details`, clean rows retain You/Them with an unconfirmed suggestion, failure rows have no suggestion, manual `s1` stays Bo and rejected `s2` stays generic. Confirm the 750/1000 ms sweep exposes five wrong suggestions, rather than hiding them. Review the official API/access distinction and explicitly resolve the native gate with Sean before marking the issue Done.
