# Mac release candidate 0.4.25

Status: Preparing, not published.

Includes the accepted desktop integration from PR #163 (6b90f68) and Google Calendar fix PR #164. Do not merge the original feature PRs again.

## Release notes

- macOS: Restore Google Calendar connection and refresh after restarting DoodleNote, with clearer recovery messages and preserved cached meetings on sync failures.
- Use one dog/calendar tray with Compact and Full Island modes and today-only upcoming meetings.
- Generate notes after Stop, resume recordings, and regenerate notes with the latest transcript.
- Reuse installed local notes models and improve recording startup and setup feedback.
- Cancel and retry abandoned Cloud connections.

## Release gates

- Production identity: com.doodlenote.desktop; Developer ID Application: SEAN INMAN (VTZW6K32K4).
- Package separately from publishing. Require accepted notarization, stapled tickets, Gatekeeper, and nested signature validation.
- Verify upgrade preserves notes, settings, selected models, and stored credentials.
- Smoke Record / Stop / Resume / regenerate, single tray with Compact / Full Island and today-only meetings, Cloud cancel / retry, and Google Calendar connect / refresh / restart.
- Publish Mac artifacts and latest-mac.yml only. Preserve Windows artifacts, download and update feed.
- Owner explicitly authorized review bypass, PR #164 merge, and necessary release merges after verification. Do not change repository protection rules.
