# DoodleNote iPhone and iPad product discovery

Status: Interview in progress. This is a decision record, not an approved build specification.

## Confirmed direction

- Design and build a fresh DoodleNote app for iPhone and iPad.
- Ignore the repository's existing iOS implementation and previous iOS design choices. They do not establish requirements for this effort.
- Use grill-with-docs, combining grilling and domain modeling, to determine requirements through interview rounds.
- Capture decisions as they are settled. Keep recommendations visibly separate from accepted requirements.
- The first audience is professionals capturing meetings, client conversations, and follow-up work.
- The anchor workflow is recording an in-person conversation, adding personal notes during it, and leaving with an accurate summary and clear next actions.
- The app must be independently useful without the desktop app and optionally connect to the existing DoodleNote cloud sync service to synchronize notes.
- Initial release scope is driven by reliable completion of the anchor workflow. No fixed launch date or budget amount has been supplied.
- Include standalone written notes and audio-file import in v1. Video import is deferred.
- Give iPad a dedicated notes/transcript layout and strong keyboard support. Apple Pencil in v1 includes editable handwriting/sketches within notes and handwriting-to-typed-text entry. Sync original editable ink as private attachments plus readable previews, editable on iPad and viewable on iPhone and desktop. This requires compatible sync/viewer extensions.
- Finished meeting records include an editable summary with key points, decisions, and proposed next actions, plus a searchable timestamped transcript linked to audio. Do not invent missing owners or due dates.
- Recording, writing notes, playback, and access to content already stored on the device must work offline. Live transcription, summaries, and meeting/library questions must also work offline on supported devices after required models and content are ready. Exact device eligibility and measured quality remain unverified.
- Core local use requires no DoodleNote account. Sign-in is required when enabling cloud sync. Optional external AI uses the user's own provider API key, with its costs separate from the sync subscription; provider selection and mobile commercial terms remain open.
- Live transcription and its accuracy are v1 priorities. It must not be deferred to a later release.
- Prefer on-device processing where it meets requirements. External AI must be explicitly enabled by the user; never silently upload content as a fallback.
- Recording continues through screen lock and app switching where the OS permits, preserves captured audio on interruption, and clearly offers resume when possible.
- Keep audio on the recording device until the user removes it. V1 cloud sync covers notes and transcripts, without cross-device audio playback.
- Next actions are editable checklists inside notes. Next-action reminders, external task integrations, and assignment workflows are deferred; calendar meeting reminders are included.
- Use a recent-first library, optional folders, and search across typed notes, summaries, and transcripts.
- Export selected notes and transcripts as PDF or Markdown through the system share sheet. Public sharing links are outside v1.
- Preserve ink, but defer automatic handwriting recognition, ink search, and AI interpretation of ink. Summaries use the transcript and typed personal notes, including handwriting entered as typed text.
- Automatic speaker separation is a desired v1 requirement subject to feasibility validation. Sean explicitly rejected treating it as deferred and wants live labels if identification can be made to work. The initial speaker-count target is three to four people. The requested explanation has been delivered; optional saved voice profiles and exact matching behavior remain proposed for final review.
- Launch with English, Danish, Spanish, French, and German, including translated interface text. Generated notes default to the meeting's selected spoken language, with a separately selectable supported output language. Preserve the original-language transcript. Use one selected primary spoken language per recording in v1; automatic mixed-language switching is deferred pending separate validation.
- Use two-hour live recordings and imports as the initial acceptance-test baseline, not a recording cutoff or a claim of measured performance. Never silently truncate longer content.
- Preserve both conflicting note versions for user reconciliation. This requires improvements to existing sync behavior; real-time collaboration is outside v1.
- Setup should let the user select a supported language and show the app's interface text in that language. English-only UI is a fallback to discuss if a concrete difficulty warrants it, not the accepted default. The five launch languages are confirmed; region variants and quality acceptance still require specification.
- Deleted notes remain recoverable in Trash for 30 days, with synchronized Trash state for synced notes and explicit confirmation for immediate permanent deletion. Detailed audio/backup and offline-expiry semantics remain open.
- Require offline generated summaries on supported devices after necessary models are ready, in the agreed languages. Device/model feasibility must validate this; preserve content for retry when unavailable.
- Core local mobile functionality is free. The existing paid cloud sync service is optional; optional external-AI provider costs remain separate. App Store purchasing/review details remain to be resolved without changing prices or publishing.
- Include offline questions about the current meeting's transcript and typed notes and homepage questions across all recordings and notes in the selected library/workspace. Offer an explicit selector to include other authorized libraries, exclude Trash, expose unavailable/unindexed content, and link answers to supporting passages. Do not inherit a recent-record-only retrieval limit.
- Include six built-in formats: general meeting, client discovery, project/status update, one-to-one, interview, and training/workshop.
- Include direct Microsoft 365/Office 365 Calendar and Google Calendar integrations in v1, with desktop calendar feature parity adapted to mobile. The recommendation to defer calendars was rejected.
- Include a complete export/restore archive through Files, preserving notes, transcripts, ink, and local recording audio. Archive protection, profile inclusion, and restore conflict behavior remain design details.
- Users explicitly choose a library/workspace for automatic note synchronization, with a clearly separate local-only library. Ordinary notes sync excludes recording audio and voice profiles.
- Regenerating a summary preserves the edited version and creates a new generated version for review before replacement. It must not silently overwrite user work.
- Support multiple Microsoft and Google calendar accounts with explicit account/calendar selection. Use invitation attendees as optional participant-name suggestions; require confirmed voice associations for speaker names.
- V1 recording covers in-person conversations or meeting audio from another device. Same-device online-call audio capture is outside v1; opening a calendar meeting link does not add that capability.

## Working method

The round records below are historical. Later accepted answers supersede earlier open wording. The confirmed direction above and the consolidated specification describe current scope.

Ask all currently answerable product decisions in each round. Research environment facts separately. Use current desktop, web, and shared-product evidence only to understand possible integration boundaries, not to impose mobile feature parity.

Maintain a glossary when product terms are resolved. Record architecture decisions only when a meaningful trade-off, significant reversal cost, and non-obvious rationale warrant one. Keep this discovery's files under OUTPUTS/doodlenote-mobile-discovery, preserving existing repository work.

The required about-me.md, working-style.md, and brand-voice.md were located and read under /Volumes/CodexSSD/Codex/Projects/AOA/CONTEXT/. They supplement the user-supplied global instructions; they do not establish DoodleNote mobile requirements.

## Round 1: Settled foundation decisions

1. First audience: Accepted the recommended professional audience.
2. Anchor workflow: Accepted in-person recording, personal notes, accurate summary, and next actions.
3. Relationship to desktop: Independent use, with optional integration into the existing cloud sync service. This does not yet settle sign-in requirements, processing location, offline guarantees, audio synchronization, or pricing.
4. Launch constraints: Accepted reliability of the anchor workflow as the initial scope criterion. This does not authorize spending or establish a budget.

## Round 2: Settled workflow decisions

5. Notes without recording: Accepted standalone written notes in the same library as recorded conversations.
6. Additional capture sources: Accepted audio-file import in v1 and deferred video import. No phone-call or other-app audio capture requirement has been accepted.
7. iPad experience: Accepted a dedicated notes/transcript layout and strong keyboard support. Sean explicitly requires Apple Pencil capabilities in v1, overriding the recommendation to defer them. Exact ink, text-entry, recognition, and sync behavior is unresolved.
8. Finished meeting record: Accepted editable summary, key points, decisions, proposed next actions, and searchable timestamped transcript linked to audio. Never invent missing owners or due dates.
9. Offline minimum: Accepted recording, writing notes, playback, and access to content already stored on the device. Offline transcription and summarization remain separate decisions.
10. Account requirement: Accepted core local use without a DoodleNote account and sign-in when enabling existing cloud sync. Processing-provider credentials and commercial entitlements remain separate decisions.

## Round 3: Settled behavior decisions

11. Pencil scope: Accepted editable handwriting/sketches within notes and handwriting-to-typed-text entry. Handwriting recognition for library search and AI input remains a separate branch.
12. Processing privacy: Accepted on-device processing where it meets requirements, explicitly enabled external AI, and no silent external fallback. Device support, providers, credentials, cost, and long-meeting quality remain separate decisions.
13. Transcript timing: Sean explicitly requires live transcription in v1 and prioritizes its accuracy, overriding the recommendation to defer live transcription. Finalization, corrections, failure behavior, and offline availability remain open.
14. Recording lifecycle: Accepted recording through screen lock and app switching where the OS permits, preserving captured audio on interruption, and clearly offering resume when possible. Recording during calls and other-app audio capture are not promised.
15. Audio retention and sync: Accepted local audio retention until user removal, with notes/transcripts sync in v1 and no cross-device audio playback. Backup, storage pressure, and deletion recovery remain separate decisions.
16. Next actions: Accepted editable checklists within notes. Next-action reminders, external task integrations, and assignment workflows are deferred. Calendar reminders are separately included.
17. Organization: Accepted recent-first library, optional folders, and search across typed notes, summaries, and transcripts. Pencil recognition/search remains a separate decision.
18. Export: Accepted selected notes/transcripts as PDF or Markdown through the system share sheet. Public sharing links are outside v1. Rendering of Pencil ink and separate audio export need follow-up.

## Round 4: Settled direction, with speaker feasibility and language details open

19. Offline live transcription: Accepted offline live transcription on supported devices after speech-asset download, preserving recording if transcription fails. Exact device/OS eligibility remains open.
20. External AI provision: Accepted user-supplied provider API keys in v1 and separate external-AI versus cloud-sync costs. Provider selection, secure credential storage, consent details, and commercial terms remain open. This does not authorize charges or set prices.
21. Ink synchronization: Accepted original editable ink plus readable previews across devices, including iPhone and desktop visibility. The private-attachment and viewer design must extend the current sync contract; this is accepted product scope, not existing behavior.
22. Handwriting in search and AI: Accepted preserved/displayed ink, with automatic ink recognition/search/AI interpretation deferred. Summaries use transcript and typed personal notes, including handwriting entered as typed text. Clearly distinguish what the AI processed.
23. Speaker attribution: Sean wants automatic speaker identification/separation in v1 if feasible, including speakers in transcript and generated notes. The recommendation to defer automatic separation was rejected. On-device feasibility is under research; separation, actual names, timing of labels, and cross-meeting voice identity need clarification. Do not silently reduce this to manual-only labeling.
24. Languages: Sean requires English plus multiple additional languages in the first release and reports multilingual desktop support is being added. The recommendation for English-only launch was rejected. Questions 30-33 subsequently settle the initial language list, content-language behavior, and translated interface scope.
25. Meeting length: Accepted two-hour live recordings/imports as the initial acceptance-test target, not a recording cutoff. Include live accuracy, battery/heat, recovery, and complete summaries. Never silently truncate longer input. Behavior beyond that baseline and resource limits still need specification.
26. Sync conflicts: Accepted preserving both conflicting versions for reconciliation. Do not silently overwrite edits or add real-time collaboration to v1. Existing cloud conflict handling requires compatible changes.

## Round 5: Partly settled; speaker-identification explanation requested

27. Speaker identity: Sean requests an explanation of what actual speaker identification would require and how it would look before deciding. Anonymous separation, confirmed meeting names, reference voice samples, and remembered profiles must be distinguished. The earlier recommendation to defer persistent profiles has not been accepted; the decision remains open.
28. Timing of speaker labels: Sean wants labels during recording if question 27 can be made feasible. This is the desired live experience, not a demonstrated runtime capability. Precise confidence, tentative/final, and correction behavior remains to be agreed.
29. Number of speakers: Sean selects three to four speakers if feasible, replacing the proposed six-speaker target. Preserve clear handling for uncertain and overlapping speech. This is an acceptance target, not measured capacity.
30. Exact launch languages: Accepted English, Danish, Spanish, French, and German, including translated interface text. Validate each for live offline transcription and generated-note behavior. These are product requirements, not measured quality results.
31. Generated-note language: Accepted the meeting's selected spoken language as the default, with a separately chosen supported summary output language when desired. Preserve the original-language transcript. Translation and generation must meet the chosen privacy requirements.
32. Mixed-language recordings: Accepted one explicitly selected primary spoken language per recording in v1. Automatic mixed-language switching is a separate capability to validate later.
33. Interface localization: Sean wants the language selected in setup to apply to screen text throughout the app. He is open to English initially if this proves too difficult and asks to be told why. Native localization is standard platform work, so retain translated UI as the intended v1 scope; do not silently take the fallback. Translation coverage and per-language QA remain required.
34. Deletion recovery: Accepted recoverable Trash for 30 days, synchronized Trash state for synced notes, and explicit confirmation for immediate permanent deletion. Audio removal and backup remain separate decisions. This is product policy, not authorization to delete existing data.

Sean subsequently explicitly accepted the recommendations for questions 30-32, resolving the earlier language ambiguity.

Question 27 explanation and the proposed live recognition experience are captured in [doodlenote_Speaker-Identification_v1.md](./doodlenote_Speaker-Identification_v1.md). The main remaining decision is whether to include optional remembered voice references across meetings or confirm names per meeting. No saved-profile behavior is accepted yet; no runtime feasibility has been demonstrated.

After the explanation, Sean acknowledged it and asked what comes next. Optional device-local saved profiles are carried forward as a proposed default in the [consolidated product brief](./doodlenote_Product-Brief_v1.md), for confirmation with the complete specification. This acknowledgment is not treated as permission to collect voice data or begin implementation. Questions 30-32 are now settled.

## Round 6: Settled launch and ownership direction

35. Offline generated notes: Accepted offline summaries on supported devices once necessary models are ready, in the agreed languages; retain content for retry when unavailable. The device/model feasibility phase must validate this and establish hardware support.
36. Mobile commercial model: Accepted free core local functionality, optional existing paid cloud sync, and separate external-AI provider costs. App Store purchase/linking design, subscription terms, and review eligibility remain implementation/distribution work. No price changes or publishing are authorized.
37. Questions: Sean requires both current-meeting questions over transcript/typed notes AND homepage questions across all recordings and notes. The recommendation to defer library-wide questions was rejected. Preserve supporting-passage links, processing/privacy choices, and the explicit exclusion of unrecognized ink. Library/workspace boundaries and offline Q&A need clarification.
38. Summary formats: Sean requires selectable built-in formats based on meeting type. Question 47 subsequently confirms six presets; custom template creation has not been requested.
39. Calendar integration: Sean explicitly requires calendar integration like desktop, starting with Office 365/Microsoft 365 and Google Calendar. The recommendation to defer it was rejected. Carry forward verified read-only calendar behaviors, with fresh native auth and mobile lifecycle handling; do not assume desktop loopback OAuth, polling, mic detection, or system-audio capture applies to iOS.
40. Backup and restore: Accepted a complete export/restore archive through Files preserving notes, transcripts, ink, and local recordings. Protection, saved-profile inclusion, and restore collisions need explicit design. This is separate from cloud audio sync.
41. Sync scope: Accepted explicit selection of a library/workspace for automatic note sync, with a separate local-only library. Ordinary notes sync excludes audio and voice profiles. Movement between libraries and account switching need ownership design.
42. Regeneration: Accepted preserving the edited summary and creating a new generated version for review before replacement. Never silently overwrite user work. Versions and corrected speaker identities need a consistent sync contract.

## Round 7: Settled calendar and question-answering details

43. Calendar accounts: Accepted multiple work/personal Microsoft and Google accounts with clearly labelled account/calendar selection. Desktop's one-account-per-provider source baseline is not the mobile limit. Shared/delegated calendar guarantees are not implied by this decision.
44. Calendar attendees: Accepted optional participant-name suggestions from invitees. Invitation membership does not establish attendance or voice identity; confirmed voice associations remain necessary. This expands the current normalized event data.
45. Offline questions: Accepted meeting and homepage questions over locally available indexed content with required models ready. Show indexing/availability gaps; do not claim complete coverage while content is unavailable. External AI remains explicitly optional.
46. Library-question scope: Accepted all records within the selected library/workspace by default, with a visible selector for deliberately including other authorized libraries. Exclude Trash and do not silently mix unrelated workspaces. Preserve full-history retrieval rather than newest-N truncation.
47. Built-in formats: Accepted general meeting, client discovery, project/status update, one-to-one, interview, and training/workshop. Templates structure supported information without inventing missing facts.
48. Same-device online calls: Accepted in-person or another-device meeting audio for v1. Calendar Join opens a meeting link but does not imply capturing that app's call audio. Same-device online-call capture is outside this first release.

## Final-review frontier

The feature decisions through question 48 are captured in [doodlenote_Specification_v1.md](./doodlenote_Specification_v1.md). The specification explicitly separates accepted requirements from proposed operational defaults D1-D6: optional device-local saved voice profiles; encrypted backups and local-only restore; account/sign-out/audio-retention handling; optional provider scope; initial distribution approach; and the native feasibility-first implementation approach. These defaults are awaiting confirmation as a package or corrections. They must not be represented as already accepted.

Engine/model choice, exact hardware/OS support, calibrated accuracy/latency targets, model licensing, native OAuth registrations, and production compatibility remain evidence-dependent implementation/distribution gates. They are not silently assumed product capabilities. No application implementation has started.

## Design tree

- Audience + anchor workflow -> launch use cases, supported content, editing and retrieval, first-use experience, success criteria.
- Anchor workflow -> capture sources, recording behavior, interruption recovery, transcript and generated-note needs, device limitations.
- Ecosystem relationship -> identity, library ownership, sync, offline behavior, conflict resolution, migration needs.
- Audience + workflows -> iPhone and iPad interaction models, Pencil and keyboard needs, accessibility.
- Launch constraints + required workflows -> v1 scope, deferred features, commercial model, operating costs, distribution.
- Content + identity + processing -> privacy, retention, export, deletion, consent, account lifecycle.
- Settled requirements -> architecture alternatives, platform support, acceptance scenarios, implementation milestones.

All round-7 feature decisions are accepted. The current frontier is the explicit final-review defaults and confirmation of shared understanding in the consolidated specification. Read-only evidence is in [doodlenote_Feasibility_v1.md](./doodlenote_Feasibility_v1.md); no mobile runtime feasibility has been demonstrated. Do not reduce accepted requirements if an engine fails testing; return the evidenced trade-off for a product decision.

These downstream branches are topics to resolve, not promised features. Recompute the tree after each round; do not silently convert a recommendation into a requirement.

## Existing cloud integration evidence

Read-only repository findings, not mobile requirements or proof of deployed behavior:

- Push/pull support standalone notes and meetings, personal and enhanced Markdown notes, timestamped speaker-labelled transcripts, titles, times, folders, and calendar references. Sources: apps/web/app/api/sync/push/route.ts:18-46 and apps/web/app/api/sync/pull/route.ts:94-124.
- Audio is absent from the push/pull contract. The media route accepts images only, limited to 3 MB, and uses public Blob access. Audio synchronization and confidential image handling need separate decisions. Source: apps/web/app/api/sync/media/route.ts:6-21,34-57.
- Cloud linking requires account session, workspace membership, and entitlement. Sync routes validate device credentials and subscription entitlement. Sources: apps/web/app/api/device/link/route.ts:16-30,52-85 and apps/web/lib/sync-auth.ts:23-45,64-97. This does not impose account requirements on independent local use or establish mobile pricing.
- Push replaces transcript and note bodies without a base-revision check. Competing pushes may overwrite edits; this is an inference from apps/web/app/api/sync/push/route.ts:154-215. Resolve conflict behavior before promising simultaneous editing.
- The delete API permanently removes meeting rows; pull includes the full surviving ID list. Mobile trash, offline deletion, and unsynced-local identity require deliberate design. Sources: apps/web/app/api/sync/push/route.ts:234-273 and apps/web/app/api/sync/pull/route.ts:26-31,44-59.
- The shared local model is broader than the cloud payload, including participant records, chat history, and trash metadata. Handwriting strokes and structured task state are not represented in this sync contract. Source: packages/meetings-store/src/types.ts:11-31,43-57,60-97, compared with push/pull above.

Follow-up branches: processing location and privacy; audio retention versus cloud notes sync; account/workspace linking and entitlement; cross-device conflicts and deletion; compatibility of any accepted Pencil or task features. Existing iOS code and design choices were excluded from this research.

## Existing non-iOS AI product evidence

Read-only source verification during round 4, not a mobile requirement or live entitlement verification:

- Desktop settings expose on-device processing and cloud with the user's own key. Source: apps/desktop/src/renderer/src/ModelsView.tsx:1385-1450.
- The shared AI engine implements Anthropic, OpenAI, Groq, OpenRouter, and local Ollama. Provider credentials are passed to the selected provider SDK. Source: packages/ai/src/cloud-engine.ts:9-46,84-99.
- The web pricing source describes Sync as server/storage features, while local AI and bring-your-own-key AI are separate from those paid sync features. No managed inference-credit service was found in the bounded web API/lib search. Source: apps/web/app/pricing/page.tsx:16-55. No live prices, entitlements, or vendor terms were checked.
- Desktop summarization passes both personal Markdown notes and transcript to the selected engine. Sources: apps/desktop/src/main/notes-service.ts:257-282 and packages/ai/src/prompt.ts:90-121,128-153. This is integration context, not automatic mobile feature parity.

## Apple feasibility evidence

Official Apple documentation reviewed on 2026-09-05, without using existing iOS code or plans. These are feasibility boundaries, not accepted technology choices:

- [PencilKit](https://developer.apple.com/documentation/pencilkit/) preserves editable drawings; [Scribble](https://developer.apple.com/documentation/applepencil) converts handwriting entered in text fields into typed text. Preserved ink and handwriting-to-text entry are distinct behaviors. Current PencilKit docs mark PKStrokeRecognizer as beta, so handwriting search, bulk recognition, and AI use of ink require separate feasibility and release-availability checks.
- [SpeechAnalyzer and SpeechTranscriber](https://developer.apple.com/videos/play/wwdc2025/277/) support local transcription of live or recorded audio, introduced in iOS 26. Device eligibility, supported locale, and downloaded model assets must be checked. Recording must remain useful when transcription is unavailable.
- [Foundation Models availability](https://developer.apple.com/documentation/FoundationModels/adding-intelligent-app-features-with-generative-models) depends on eligible hardware, Apple Intelligence settings, and model readiness. Its [4,096-token context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window) means long meetings require chunking and quality validation. Neither choosing a native framework nor setting a minimum OS alone proves accurate offline summaries for all users.
- Apple documents [background and locked-screen recording](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record) and [audio interruptions](https://developer.apple.com/documentation/AVFAudio/handling-audio-interruptions). Calls and some iPad cover behavior can interrupt or mute capture; preserve audio and validate recovery on physical devices.
- Apple's documented [transcription results](https://developer.apple.com/documentation/speech/speechtranscriber/result) and [result attributes](https://developer.apple.com/documentation/speech/speechtranscriber/resultattributeoption) describe text, timing, confidence, and tentative/final results, but do not establish automatic speaker separation or names. This is a documented capability boundary, not proof that on-device diarization is impossible. Automatic speaker attribution would require separate feasibility work.

## Completion condition

Reach shared understanding on the remaining decisions and obtain the user's confirmation before starting implementation. No application code has been changed for this discovery.

## Final approval, 2026-09-06

Sean confirmed: "Yes this all looks good. Are we ready to build?" The complete specification and defaults D1-D6 are accepted. Shared understanding is established and implementation may start. Earlier pending-review statements above are historical. A fresh native foundation is being built in an isolated worktree; physical-device feasibility and all release gates remain open.
