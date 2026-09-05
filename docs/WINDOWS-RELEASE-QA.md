# Windows release acceptance

The current delivery target is a Windows x64 beta. A working short transcript
does not establish production readiness. Keep ONY-231 open until the installed
candidate has passed the physical checks below.

## Automated recording smoke

Run recorder regressions with the actual Electron runtime:

```sh
node apps/desktop/scripts/test-electron-runtime.cjs apps/desktop/release/win-unpacked/DoodleNote.exe
```

For end-to-end capture, install Playwright 1.62.1 separately and set
`DOODLE_PLAYWRIGHT_MODULE` to its module directory if it is not resolvable.
Prepare a synthetic speech WAV and a model cache containing the live Zipformer
and final Whisper models. Use only synthetic or explicitly approved fixtures.

```sh
node apps/desktop/scripts/smoke-windows-refinement.cjs <packaged-exe> <models-directory> <synthetic.wav> <expected-phrase>
```

The script creates an isolated temporary profile, injects synthetic microphone
audio, verifies live captions, saved audio, refinement, replacement and session
persistence, and terminates only its own application process tree. The source
profile and the user's installed app are not modified. The expected phrase is
a flow check; score the entire final transcript separately for accuracy.

## Physical acceptance

- Test both a built-in microphone and a USB/Bluetooth headset on supported
  Windows devices. Record exact OS, CPU, app version and microphone model.
- Say “The final confirmation number is seven four nine,” then immediately
  click Stop. Do not speak the testing instruction. Confirm the final transcript
  contains “final confirmation number” and the complete number.
- Record varied names, dates, numbers, pauses, accents and speaking speeds.
  Compare saved audio with both provisional and final transcripts. Record word
  substitutions, omissions and additions; do not accept a model based on one
  successful sentence.
- Capture microphone only, system audio only, and both together. Verify labels,
  chronology, playback seeking and final words. Start a recording immediately
  after app launch to exercise startup recovery.
- Test a 30–60 minute meeting, Stop/Resume, several recording parts, microphone
  switching, sleep/wake, and disconnect/reconnect. Confirm no lost or duplicated
  speech, runaway memory, or indefinitely pending finalization.
- Verify fresh-profile model setup, interrupted download and retry, offline use
  after setup, and closing the app during refinement. Preserve usable live text
  and saved audio when refinement fails.
- Reopen the app and confirm transcript persistence, re-transcription, notes,
  export and configured sync. Keep personal recordings out of issues and logs.
- Upgrade an existing beta through Settings: discovery, download, progress,
  cancellation, retry, explicit Restart to update and the resulting version.
  Interrupt the network during a download: after 90 seconds without new bytes,
  Settings should show a short error and offer Retry update.

## Production gate

Record candidate commit, installer hash, observed checks, skipped environments
and remaining failures. Require a valid Windows Authenticode signature before
production publication through `release:win`. An unsigned beta is suitable for
authorized testing only; do not promote it by replacing `latest.yml`.

The initial repaired capture/refinement smoke still misrecognized one synthetic
access-code digit with Whisper tiny.en. The flow is verified; the representative
accuracy acceptance remains open and may require a stronger local model.
