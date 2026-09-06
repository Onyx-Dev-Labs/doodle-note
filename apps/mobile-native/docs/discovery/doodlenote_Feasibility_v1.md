# DoodleNote mobile speech and speaker feasibility

Status: Read-only source research, 2026-09-05. No models installed, code executed, device benchmarks run, or mobile engine selected. Existing iOS implementation and plans were excluded.

## Accepted requirements driving this research

Accurate live transcription, offline operation after model download, multilingual launch, and a two-hour recording/import acceptance baseline. Automatic speaker separation is a desired v1 requirement if feasible, with speakers represented in the transcript and generated notes. Real-name recognition, persistent voice profiles, and live speaker-label timing remain separate product decisions.

## Current desktop language evidence

- [Open PR 117](https://github.com/Onyx-Dev-Labs/doodle-note/pull/117), checked at head 55c8bc0bf7148d107bd170b991e1828ef72b12a3, adds English/Multilingual selection for macOS batch imports and retranscription. It excludes multilingual live captions and generated-note language settings. Windows ignores that setting. This verifies ongoing work, not a released feature.
- [Issue 118](https://github.com/Onyx-Dev-Labs/doodle-note/issues/118) describes Danish conversational recognition problems and requests an optional offline Whisper batch engine. Danish is an evidence-backed language priority. Contributor quality comparisons are not independently validated benchmarks.
- Current non-iOS source uses English streaming (engine/Sources/engine/Commands.swift:206), default Parakeet v2 batch unless v3 is specified (same file:16), and a plain-English generated-notes prompt (packages/ai/src/prompt.ts:27). These desktop choices do not constrain the fresh mobile product.
- Desktop mic-versus-system-audio speaker grouping is capture-source separation, not proof of multi-person room diarization. Source: engine/Sources/engine/LiveCommand.swift:9.

## Candidate assessment

### First candidate to evaluate: FluidAudio

Native Swift/CoreML makes FluidAudio a candidate for Apple-device evaluation. Its [package](https://raw.githubusercontent.com/FluidInference/FluidAudio/main/Package.swift) declares iOS 17+, but a build minimum does not prove performance or establish our minimum supported device. The [library](https://github.com/FluidInference/FluidAudio) is Apache-2.0.

- Final speaker separation: [converted Community-1 model](https://huggingface.co/FluidInference/speaker-diarization-coreml) and [upstream Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) document offline speaker segments/timestamps and label their models CC-BY-4.0. Upstream offers exclusive diarization useful for transcript alignment; wrapper support and exact downloadable artifact rights still need verification. A language-independent acoustic approach is not proof of equal accuracy in every language.
- Live speaker labels: [LS-EEND documentation](https://raw.githubusercontent.com/FluidInference/FluidAudio/main/Documentation/Diarization/LS-EEND.md) describes streaming variants with four, seven, or ten speakers, but documents up to one hour. Two-hour stability and model artifact licensing were not verified. Do not silently assume chunking preserves speaker identity across that limit.
- Alternative live labels: [Sortformer documentation](https://raw.githubusercontent.com/FluidInference/FluidAudio/main/Documentation/Diarization/Sortformer.md) describes four unique speakers and weaknesses with overlap or quiet/distant voices. Its memory measurements are vendor reports, not this app's device measurements. The [upstream checkpoint](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1) and [converted checkpoint](https://huggingface.co/FluidInference/diar-streaming-sortformer-coreml) show differing license labels; resolve the exact artifact terms before selection.
- [Model documentation](https://raw.githubusercontent.com/FluidInference/FluidAudio/main/Documentation/Models.md) lists streaming Nemotron multilingual for English, Spanish, French, Italian, Portuguese, German, Chinese, and Japanese. Parakeet v3 is described as 25 European languages through batch/sliding-window transcription. These are documented model capabilities, not demonstrated simultaneous two-hour mobile transcription/diarization performance. Danish live quality remains a specific validation need.

### Comparison candidate: sherpa-onnx

[Official iOS build documentation](https://k2-fsa.github.io/sherpa/onnx/ios/build-sherpa-onnx-swift.html) supports iPhone/iPad builds and an older minimum OS. The [Swift diarization example](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/swift.html) uses an offline diarization API; support for streaming speech recognition does not establish streaming speaker separation. The library is Apache-2.0, while [model licenses](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html) must be checked separately. A pyannote segmentation model needs a compatible speaker-embedding model and clustering; it is not a complete solution alone.

## Apple language and speech boundary

[SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber) exposes hardware availability, supported locales, and installed locales. The [Apple sample](https://developer.apple.com/videos/play/wwdc2025/277/) checks assets and installs missing models, with limits on concurrently allocated languages. Exact launch language commitments require device/runtime checks and language-specific testing.

Apple's documented [result fields](https://developer.apple.com/documentation/speech/speechtranscriber/result) do not establish speaker IDs or names. Speaker separation and real-name identity must not be assumed from choosing Apple's transcription API.

## Required validation before selecting an engine

The launch-language requirements are now English, Danish, Spanish, French, and German, including interface text. Recordings have one selected primary spoken language. Generated notes default to it with an optional supported output-language override, preserving the original transcript. This acceptance does not establish runtime model quality or readiness.

- Select minimum physical iPhone/iPad targets and run recording, live transcript, and Pencil editing together, including speaker processing at the accepted stage.
- Validate each committed language with real conversational test material whose use is authorized. Include names, accents, interruptions, room noise, and domain terms.
- Measure transcript accuracy, speaker-attribution accuracy, latency, memory, heat, battery use, and model-download size. Set acceptance thresholds before claiming success; no measured results exist yet.
- Test two hours with speakers arriving, returning after silence, speaking softly, and overlapping. Preserve source timestamps and stable identities through the final alignment.
- Preserve complete audio through processing errors, screen lock, app switching, calls, low storage, and restart. Validate export/recovery and prohibit silent truncation.
- Distinguish anonymous speaker clustering from actual names. Corrections must propagate consistently to transcript and generated notes without replacing user edits silently.
- Review exact library/model versions, licensing, redistribution, downloads, and offline availability before embedding assets.

No technical candidate is an approved architecture decision. This research supports the next interview round and a later explicitly scoped feasibility implementation after shared understanding is confirmed.

## Offline summaries and distribution boundaries

Additional official Apple research for round 6, 2026-09-05:

- [Apple Intelligence requirements](https://support.apple.com/en-us/121115) list the five selected languages with iOS/iPadOS 26.1, subject to feature availability. Apple Intelligence hardware eligibility, region/settings, and downloaded model readiness are separate constraints; the broad list alone does not guarantee a particular Foundation Models operation.
- [Foundation Models language guidance](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models) directs checking supportsLocale and supportedLanguages. Check both source and requested output language plus [model availability](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel). Device performance and language quality still need measurement. An alternate local-model strategy would need independent validation if Apple's model is unavailable on a desired target device.
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) section 3.1.3(f) provides a potential route for free standalone companions to paid web tools, including cloud storage, without in-app purchase when there is no in-app purchasing or outside-purchase call to action. It is conditional on the actual product and review, not a DoodleNote approval guarantee. Sections 3.1.1 and 3.1.3(b) may govern other digital unlocks; storefront-specific exceptions must not become an assumed global purchase design.
- The same guidelines do not establish a blanket bring-your-own-key exemption. Third-party AI data sharing needs clear disclosure and explicit permission under 5.1.2(i); entering a key alone must not silently authorize undisclosed data sharing. A reviewable demo/account path will be required for services that reviewers need to exercise.

These findings do not approve mobile pricing, purchase links, subscriptions, third-party data transfers, or App Store publication. They identify constraints for the proposed commercial and AI experience.

## Desktop calendar and Q&A baseline for round 7

Read-only non-iOS source inspection; installed/deployed behavior was not tested:

- Desktop connects Microsoft and Google directly through read-only OAuth/PKCE. Desktop loopback callbacks and Electron token protection must be replaced by native mobile mechanisms. Sources: apps/desktop/src/main/calendar-service.ts:62,140 and apps/desktop/src/main/google-calendar.ts:9.
- One account per provider is represented, with both providers usable simultaneously and multiple selectable calendars. Defaults are selected initially; events are color-coded. Sources: apps/desktop/src/shared/calendar-api.ts:58,84 and apps/desktop/src/renderer/src/ModelsView.tsx:757. Multiple accounts per provider would expand this baseline.
- Upcoming events cover 14 days, with local caching and refresh while the app runs. Both provider implementations currently limit initial event results without pagination. Mobile must handle complete results for the chosen date range instead of inheriting silent truncation. Sources: apps/desktop/src/main/calendar-service.ts:64,147,789 and apps/desktop/src/main/google-calendar.ts:168.
- Join opens the event link. Take notes creates a titled event-linked meeting and starts recording; an already-linked nontrashed meeting is reopened without automatically restarting recording. Sources: apps/desktop/src/renderer/src/HomeView.tsx:53,294 and apps/desktop/src/renderer/src/App.tsx:141.
- Desktop prompts near event start, skips all-day/duplicate prompts, and uses desktop-specific banners/notifications/panels. These express reminder intent, not a requirement to copy desktop mic detection or polling into iOS. Sources: apps/desktop/src/main/calendar-watcher.ts:7 and apps/desktop/src/main/calendar-service.ts:856.
- Event normalization preserves organizer and hasParticipants but no attendee list. Participant-name suggestions require additional data handling. Source: apps/desktop/src/shared/calendar-api.ts:25.
- Disconnect forgets local provider/session information; provider-wide consent revocation is not established for all paths. Sources: apps/desktop/src/main/calendar-service.ts:559 and apps/desktop/src/main/google-calendar.ts:120.
- Current meeting Q&A uses transcript, typed notes, generated notes, and recent chat. Homepage Q&A instead selects the newest 30 nontrashed records and a 20,000-character default budget, preferring generated notes. It does not satisfy the new full-library transcript/typed-note retrieval requirement. Sources: packages/ai/src/ask-prompt.ts:38; apps/desktop/src/main/notes-service.ts:58,395,605; packages/ai/src/global-ask-prompt.ts:23. Mobile requires an index over eligible full-history sources and evidence-linked answers, not a copy of this recency-limited prompt.

## Native calendar integration boundaries

- [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) supports native public clients with PKCE. [calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0) lists Calendars.ReadBasic as minimum delegated access for time-range occurrences; [permission definitions](https://learn.microsoft.com/en-us/graph/permissions-reference#calendarsreadbasic) exclude body/attachments/extensions from that basic scope. Agenda/body or shared/delegated calendar requirements change the permission design. [Tenant consent policy](https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience) can still prevent user authorization.
- [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) and [iOS API access](https://developers.google.com/identity/sign-in/ios/api-access) support direct provider connections. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) include event-readonly and calendar-list-readonly scopes, without Gmail access. Public distribution of sensitive-scope access requires applicable [verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification); this is a release dependency, not proof that the existing mobile client is configured or approved.
- Direct calendar authorization can be separate from a DoodleNote account/subscription. EventKit alone is not equivalent to direct provider connections: it depends on device calendar configuration, and [reading event-store data](https://developer.apple.com/documentation/eventkit/accessing-the-event-store) requires full calendar access rather than a read-only grant.
- Cache already fetched events for offline display and label freshness. [Google incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync) documents handling changed/deleted events and invalidated sync tokens. Offline access permission enables token renewal, not live updates without networking.
- [Local notifications](https://developer.apple.com/documentation/UserNotifications/scheduling-a-notification-locally-from-your-app) can remind users while the app is not running. [Background task scheduling](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app) is system-controlled, and Apple documents [background recording-start failures](https://developer.apple.com/documentation/coreaudiotypes/avaudiosession/errorcode/cannotstartrecording). Use a reminder that opens meeting actions and explicit user-started recording. No guaranteed calendar-triggered background microphone start is established.

No calendar account was connected, OAuth registration changed, credential collected, event written, or permission granted during research.
