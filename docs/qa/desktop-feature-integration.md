# Accepted desktop feature integration

This branch assembles the accepted desktop batch into one PR against main.
It does not bump the public version, publish installers, or change updater feeds.

## Source scope

Base: `68fbc7c0507c536ce04caed03dabf19f4935ede4`.
The nine original PR heads are retained as ancestors, with conflicts resolved in
integration commits. Keep the original PRs open until the integration is merged
and reconcile them with the resulting main history afterward.

| Issue | Source PR | Included head | Outcome |
| --- | --- | --- | --- |
| ONY-274 | [#151](https://github.com/Onyx-Dev-Labs/doodle-note/pull/151) | `ca3ff5ec22f1dfb51570058df5d3e01ce74208cd` | Stable sidebar hover |
| ONY-270 | [#155](https://github.com/Onyx-Dev-Labs/doodle-note/pull/155) | `e533d4d2239927e9ad15563192c2fd71aa72de7b` | Dog tray and recording startup |
| ONY-269 | [#152](https://github.com/Onyx-Dev-Labs/doodle-note/pull/152) | `32aa0b716824065d32ecc5c55f5069b195605519` | Meeting detection prompt |
| ONY-271 | [#154](https://github.com/Onyx-Dev-Labs/doodle-note/pull/154) | `296f13b02ad7aa2d9bf0c9b18eb9d833cf7fb79f` | Automatic notes, Resume and regeneration |
| ONY-278 | [#156](https://github.com/Onyx-Dev-Labs/doodle-note/pull/156) | `516714d66b601a8ac36890d839cc04e4d1ef6b98` | Reuse installed local models |
| ONY-273 | [#159](https://github.com/Onyx-Dev-Labs/doodle-note/pull/159) | `3ae07deeecf169e06bbf8ad2bb7611639db48c9b` | Recover abandoned cloud connections |
| ONY-275 | [#160](https://github.com/Onyx-Dev-Labs/doodle-note/pull/160) | `e333bd57880eab729d0f2b74d3eeb064b2664c4b` | Recording permission/status behavior |
| ONY-276 | [#161](https://github.com/Onyx-Dev-Labs/doodle-note/pull/161) | `715b58ca0555fa916cdaab91a9b37907999eab02` | Recording and navigation arrow alignment |
| ONY-277 | [#162](https://github.com/Onyx-Dev-Labs/doodle-note/pull/162) | `d59ff93cb389e7855957fa908fad6e17e8a4ea49` | Transcription setup loading activity |

ONY-279 remote MCP visibility and active-trial support are already in the base
via #157/#158. ONY-272 was withdrawn. ONY-268 and unrelated open PRs are outside
this release scope.

## Accepted local follow-ups

The accepted Local source reference is `551fc45` (runtime changes through
`b727e78`). In addition to the original PR heads, this integration preserves:

- Single dog tray with today's upcoming meetings and Compact / Full Island;
  template idle artwork and the white recording dog with red facial features.
- Release of the pending-recording guard after capture finalization, so Resume
  works with the persistent engine.
- Readiness tracking so denied or failed startup does not trigger automatic notes.
- Async model lookup combined with automatic-notes selected-provider safeguards.
- Setup names the selected ready model; another downloaded model cannot make
  setup claim the selected model is ready.
- Correct generation wrapper, transcript cue and vector arrow layout together.
- Prompt smoke selectors distinguish calendar dismissal from notes-error dismissal.

The Swift engine, shared packages, and tray assets match the accepted Local
source. All remaining runtime differences from that reference are accounted for:

- ONY-273's source PR is included here. It was absent from the latest combined
  Local source, despite earlier blanket statements that every PR was included.
- Normal production updater and legacy migration behavior from main are retained.
- Local-only app identity/configuration, disabled updater, temporary meeting
  preview and standalone preview tray are excluded. Calendar and recording
  functionality remain the accepted implementation.
- A formatting-only cleanup in FirstRunWizard resolves its existing lint warning.

The web source, dependency manifests/lockfile, release feeds and GitHub workflows
match the base. Its dependency updates already resolve the old #154 audit failure;
the fresh production audit reports no known vulnerabilities.

## Verification

- Frozen dependency installation passed.
- Desktop typecheck, build and lint passed (the imported formatting warning was fixed).
- Desktop suite: 248 passed, six existing environment skips, zero failures.
- Notes engine package: 23 passed; MCP: five passed; meeting store: 15 passed.
- Production dependency audit: no known vulnerabilities.
- Source ancestry: all nine listed PR heads are included.
- Swift production engine build passed; existing upstream concurrency warnings remain.
- Recording-prompt Electron smoke: eight scenarios passed, including closed-window
  start, repeated-start rejection, existing-meeting Resume and engine failure.
- Cloud-link Electron smoke passed: cancel/retry, keyboard, navigation/remount,
  launch/invalid/timeout failures, onboarding and Settings success, disconnect.
- Automatic-notes Electron smoke passed, including denied startup, both Stop
  routes, the setting on/off, stale-output rejection, Resume, retry and persistence.
  The fixture now pins a valid selected model ID before launch so real cache
  discovery cannot invalidate its synthetic model selection.

## Acceptance and release boundary

Alec reported manually verifying each issue and accepted the Local tray follow-up.
That acceptance is retained; this PR does not require repeating every issue test.
Automated integration checks cover the conflict resolutions and ONY-273 addition.
The final signed production artifact and upgrade path remain release-stage work.

Check this when preparing the production candidate:

1. Upgrade an existing installation: notes, settings and selected models remain;
   the installed app retains its production identity and can check for updates.
2. Record, Stop, Resume and regenerate: continued transcript is retained and
   notes generation respects its setting without duplicates.
3. With a real calendar meeting today, switch Compact / Full Island: one dog tray
   remains; later dates do not appear as today's next meeting.
4. Cancel an abandoned Cloud connection and retry: controls recover, and stale
   callbacks cannot connect a cancelled attempt.

No new database migration or account permission scope is introduced. Merge,
production signing/notarization, publication and installed-upgrade verification
remain separate steps. The user authorized bypassing code-owner approval for the
future merge, not weakening automated checks or publishing this branch now.
