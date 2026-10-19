# Persisted overlap after recording deletion

Independent review of `02c0bb4` (also present at `35f965c`) reproduced an introduced P2: two overlapping persisted part intervals were ambiguous while both recordings existed, but deleting one recording caused its metadata to be ignored. Availability and playback then substituted the surviving part. Reviewer reproduction: `/tmp/dev507-audio-home-review-DLumuR/audio-probes.cts` and `audio-probes.log`.

Author reproduced two desired-behavior failures on the unchanged implementation: deleting an overlapping recording incorrectly returned available; a previously valid token incorrectly played after an overlapping metadata-only part appeared. RED log: `/Users/sean/.t3/worktrees/doodle-note/t3-d30e320c/.superpowers/sdd/2026-10-18-dev507-cited-ask/audio-missing-part-old-red.log`.

The fix reads persisted timing before considering audio-file presence. An overlapping part without bytes makes playback unavailable. Missing/corrupt timing remains conservatively unavailable. A known nonoverlapping missing recording does not block the unique valid part. Public interfaces and host/renderer wiring are unchanged.

Focused actual-filesystem adapter and Home-controller checks: 17 passed, zero failures/skips; desktop node types and touched-file lint passed. Single/multi-part exact seek, changed/deleted originals/bytes, token expiry, owner/cancel/relocation cleanup and the two new regressions are included. Stand-in bytes are synthetic and do not qualify native decoding/audible seek. Fresh independent verification remains required; earlier A1/A2 and Home reviews are separate.
