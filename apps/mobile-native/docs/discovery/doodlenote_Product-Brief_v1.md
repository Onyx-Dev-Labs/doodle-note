# DoodleNote iPhone and iPad: product brief

Status: Product scope and operational defaults approved by Sean on 2026-09-06. Implementation is authorized; release and production changes require separate approval.

Updated 2026-09-06. See the [v1 specification](./doodlenote_Specification_v1.md) for the complete accepted scope, accepted operational defaults, and validation plan.

## Product purpose

An independent iPhone and iPad app for professionals to capture in-person conversations, add personal notes, and leave with an accurate transcript, useful summary, and next actions. Existing iOS implementation and planning are excluded. Desktop, shared-model, and cloud evidence informs compatibility only.

## Accepted first-release scope

| Area | Required behavior |
| --- | --- |
| Capture | Live in-person audio recording and audio-file import; standalone notes also supported. |
| Live transcript | Accurate text during recording, including offline operation on supported devices after required models are downloaded. Preserve audio if processing fails. |
| Speakers | Automatic separation and identification pursued as a v1 requirement subject to feasibility, with live labels desired. Initial target: three to four speakers. Optional device-local saved voice references are accepted; model quality and matching behavior need validation. |
| iPad notes | Dedicated notes/transcript layout, strong keyboard support, editable Pencil handwriting/sketches, and handwriting-to-typed-text entry. |
| Generated notes | Editable summary, key points, decisions, and proposed next actions as checklists. Built-in meeting-type formats. Use transcript and typed personal notes. Preserve edited versions when regenerating. Never invent owners or due dates. |
| Ink | Preserve and synchronize original editable ink and readable previews. Automatic ink recognition, ink search, and AI interpretation of ink are deferred. |
| Library | Recent-first notes and recordings, optional folders, search across typed notes/summaries/transcripts, timestamp-linked playback when audio exists locally. |
| Offline core | Recording, personal notes, locally stored content, playback, live transcription, summaries, and meeting/library Q&A after necessary models/content are ready. Validate all five languages on supported devices. |
| Accounts and AI | Free core local functionality without a DoodleNote account. Existing paid Sync is optional; external AI uses user-supplied provider credentials and separate costs. On-device-first processing with no silent external fallback. |
| Sync | Explicitly choose a library/workspace for automatic note sync, retaining a separate local-only library. Sync notes, transcripts, ink, and previews. Preserve conflicts and edited summaries. Compatible cloud/viewer changes are part of scope. |
| Audio | Retain on the recording/importing device until user removal. Cross-device audio playback is outside v1. |
| Languages | English, Danish, Spanish, French, and German, including interface text. One selected spoken language per recording. Generated notes default to that language, with a supported output-language override; preserve the original-language transcript. |
| Questions | Offline meeting questions and homepage full-history questions with passage links. Default to the selected library/workspace; explicitly select additional authorized libraries. Exclude Trash and show unavailable/unindexed content. |
| Calendars | Multiple Office 365/Microsoft 365 and Google accounts; read-only calendar selection, upcoming events, linked notes, links and reminders. Invitee-name suggestions require confirmed voice associations. Same-device call capture is outside v1. |
| Export and recovery | PDF/Markdown sharing and a complete export/restore archive preserving notes, transcripts, ink, and local audio. Recoverable Trash for 30 days, synced Trash state for synced notes, and confirmation for immediate permanent deletion. |
| Reliability | Continue recording through screen lock/app switching where permitted, preserve audio on interruption, clearly offer resume. Two-hour live/import test baseline, with no silent truncation of longer content. |

## Accepted speaker approach

Sean approved optional device-local saved voice profiles with default D1 on 2026-09-06:

- Start recording without mandatory voice enrollment.
- Show anonymous labels until named or reliably matched.
- Let users confirm a name and optionally remember a voice on this device.
- Select known participants for later meetings; leave unknown or ambiguous voices unassigned.
- Correct a passage or tracked speaker and use corrected attribution in the final transcript and generated notes.
- Keep voice-reference data outside normal cloud note sync. References, profile storage, matching thresholds, correction/version behavior, and exact consent screens require design and validation.

This does not authorize recording anyone or collecting voice-reference data. No runtime capability has been demonstrated.

## Settled language decisions

- Q30 accepted: English, Danish, Spanish, French, and German, including translated interface text.
- Q31 accepted: generated notes default to the meeting's selected spoken language, with a separate supported output-language override. Preserve the original transcript.
- Q32 accepted: one selected primary spoken language per recording in v1; automatic mixed-language switching is deferred pending separate validation.

## Current decision round

Questions 43-48 are also settled: multiple calendar accounts, attendee suggestions, offline Q&A, explicit full-library scope, six meeting-type presets, and exclusion of same-device online-call capture. Operational defaults D1-D6 and shared understanding were confirmed on 2026-09-06.

## Calendar behaviors derived from requested desktop parity

Connect Microsoft and Google calendars directly and independently from DoodleNote cloud sync, select calendars, display upcoming events and cached offline information, open meeting links, and create/reopen a titled event-linked note. Use opt-in meeting reminders and an explicit user action to start recording. Preserve created notes if a calendar event changes or disappears. Fetch complete results for the selected date range and handle individual recurring occurrences without creating duplicate notes.

The source baseline has a 14-day view and one account per provider. Mobile expands it to multiple accounts per provider and attendee-name suggestions. Calendar editing and invitations are not part of the requested read-only desktop behavior. Native authentication, notifications, and refresh replace desktop-specific loopback sign-in, polling, and mic detection.

## Other decisions to close before the final build specification

- Exact device/OS support and language-specific engine choices, informed by an explicitly scoped device feasibility phase rather than assumed from library compatibility.
- Model readiness, optional external providers, failure/retry behavior, and measured quality acceptance criteria for offline summaries and the other speech/AI features.
- App Store distribution/purchase flow and consumption of existing sync entitlements. Free local functionality is accepted; no purchase flow or release has been approved.
- Feature choices above are accepted; exact native authentication, retrieval/indexing, and provider integration behavior still requires implementation validation.
- Synced Trash, local audio deletion, backup/export, account switching/sign-out, workspace scope, and old-client compatibility details.
- Final speaker-profile behavior and treatment of corrected or regenerated content without losing user edits.

## Proposed delivery sequence

1. Complete: product scope, defaults, exclusions, and acceptance scenarios reviewed with Sean.
2. Complete: Sean confirmed shared understanding and authorized implementation on 2026-09-06.
3. Build a narrowly scoped native feasibility prototype for simultaneous durable capture, offline multilingual live transcription, live speaker identification, and Pencil use on physical iPhone and iPad. Evaluate exact model artifacts and distribution rights. Measure the complete two-hour workflow before choosing the supported-device floor.
4. Resolve evidence-based architecture decisions and build the native user experience plus compatible cloud/viewer extensions in isolated editing workspaces.
5. Verify end-to-end capture, interruption recovery, language quality, speaker correction, sync/conflicts, ink, export, deletion recovery, and real-device performance before a reviewed beta/release process.

Feasibility failure must produce an explicit trade-off for Sean; it must not silently remove live transcription, multilingual support, Pencil, or requested speaker behavior.

## Supporting records

- [Discovery decisions](./doodlenote_Discovery_v1.md)
- [Domain glossary](./CONTEXT.md)
- [Speech and language research](./doodlenote_Feasibility_v1.md)
- [Speaker identification proposal and diagram](./doodlenote_Speaker-Identification_v1.md)
- [Independent use and sync decision](./docs/adr/0001-independent-mobile-with-existing-sync.md)
- [Processing privacy and local audio decision](./docs/adr/0002-explicit-external-ai-and-local-audio.md)
- [Ink and conflict preservation decision](./docs/adr/0003-extend-sync-for-ink-and-conflict-preservation.md)
