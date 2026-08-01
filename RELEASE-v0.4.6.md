# DoodleNote v0.4.6 release candidate

## Included

- [x] Existing output-only meeting detection fix from PR #47
- [ ] Coordinate calendar and microphone detections into one prompt
- [ ] Suppress prompts while DoodleNote is already recording
- [ ] Prevent a background prompt from reappearing as an in-app banner
- [ ] Preserve one prompt for a real ad-hoc meeting-app microphone session
- [x] Bump desktop version from 0.4.5 to 0.4.6
- [x] Add the v0.4.6 changelog entry

## Verification

- [ ] Focused notification regression tests
- [ ] Full desktop test suite
- [ ] Desktop Node and renderer typechecks
- [ ] Changed-file lint and formatting
- [ ] Production Electron build
- [ ] Signed and notarized arm64 package
- [ ] Live update feed reports 0.4.6
- [ ] Installed application and running process report 0.4.6
- [ ] Output-only Zoom Phone smoke test produces no prompt
- [ ] Scheduled Zoom meeting produces one prompt total

## Release gates

- [ ] Release PR reviewed
- [ ] User authorizes merge and publication
- [ ] Published artifact checksum matches the live update manifest
