# DEV-509: local pre-meeting briefs — approved design

Approved by Sean on 2026-10-18: **“Approve designs and stacked implementation”**, covering `/tmp/doodlenote-next-features-20261018.md` and the linked DEV507/DEV509 DESIGN and PLAN documents. This supersedes historical unapproved and prerequisite-merge-before-edit wording. Isolated implementation starts above exact PR230 `bbb352bd96fc60b504ecf73793f6ea4564c54d16`; DEV509's final integration stacks on the tested DEV507 service. Required human/CODEOWNER review, final merge order, quality gates and native/release QA remain. No merge or release authority is added.

## Outcome and boundaries

From an upcoming desktop calendar event, **Open brief** opens a local panel with correctable invitee/company/history associations and dated prior decisions or commitments cited to original local notes/transcripts. Empty or unknown identity/history is explicit. The feature stays usable with cached calendar data offline and an available local model. It has no recording, joining, messaging, CRM/mail/web research, cloud inference or automatic model download side effects.

The issue's five acceptance criteria are binding: event entry and cited original history; correctable provenance without cross-account name merge or acoustic inference; freshness on open/wake/refresh with disconnect/offline/cancel/no-model states; preservation of every calendar start path and manual speaker behavior; dated historical commitments without unsupported current task status. Account-free local SourceScope remains `{libraryId,accountId:null,workspaceId:null}` independently of calendar/DoodleNote sign-in. Calendar provenance never proves cloud export authorization.

## Readiness and current evidence

[DEV509](https://app.notion.com/p/3fcf0f846ee4819f9dfdf0d1241ec256) was claimed and read back for Sean on 2026-10-18 at 19:27 UTC, In Progress. Exclusive lane: `t3/calendar-context-brief-integration`, `/Users/sean/.t3/worktrees/doodle-note/t3-c80f9eb4`, exact starting base `bbb352bd96fc60b504ecf73793f6ea4564c54d16`. Parent coordinates independent review; required human/CODEOWNER review and Sean's native QA remain. Independent calendar modules proceed in parallel; final brief integration consumes DEV507's actual tested service.
Read the complete existing `/tmp/dev509-research.YxxO2E/HANDOFF.md`, `DEV507-SEAM-REVIEW.md`, `probe-results.json` and `/tmp/dev507-research.cmUJjB/DEV507-readiness-plan.md`. Their DEV114 investigation is sufficient: the single-attendee automatic speaker seeding described historically was absent in PR63 and prior source, not a proven shipped regression. Do not reopen DEV114 or claim this feature implements acoustic assignment.

Current source checked read-only: `/Users/sean/.t3/worktrees/doodle-note/t3-fd27af2f`, clean HEAD `bbb352bd96fc60b504ecf73793f6ea4564c54d16`. Compared with prior `63d2a588f8d685fa9792ef48268f8a3e425e0ed4`, the 14-file delta concerns global Ask coverage, local-engine budgeting, recipe/fetch language and tests. Calendar normalization, canonical identity, recording-start routes, speaker helpers, original projection and library relocation contracts are unchanged. `CONTRIBUTING.md` and `apps/desktop/docs/calendar-accounts.md` were read. No applicable desktop/root AGENTS.md was found in the checked ancestry; apps/web/AGENTS.md is outside scope.

Current source anchors (all at that exact HEAD):

- `shared/calendar-api.ts:30`: opaque account/calendar/occurrence keys exist, roster does not. `google-calendar.ts:427` and `calendar-service.ts:1470` discard attendee identities.
- `calendar-identity.ts:57`: retain existing event key derivation; start time is not identity. Provider moves may change provider identity; never unify by title, series, time or meeting URL.
- `index.ts:180`, `calendar-service.ts:284`, `recording-start-coordinator.ts:46`, `renderer/src/lib/recording-start.ts:5`: all real calendar starts converge on trusted resolution and reservation, then renderer creation/reuse. `recording.attach` occurs before a new original exists; do not persist a meeting link at attach alone.
- `speakers.ts:95` is an unconditional participant upsert, not a priority merge. Brief association code must not call it. Manual roster/cleared labels and existing calendar-labelled participants remain untouched.
- `library-storage.ts:22` has an explicit content allowlist. `calendar-account-store.ts:145` fences account lifetime. `CalendarService.visibleEvents` exposes stale cached events while the connection remains. There is no existing brief/wake handler.
- DEV507 owns retrieval, citation checking, prompt budget, local generation and source UI. DEV509 owns calendar context, associations, event lifecycle, local metadata and ephemeral brief caching.

## Approach and material choices

Recommended: **explicitly confirmed identity rules, immutable calendar observations, local sidecar, ephemeral generated briefs**. This meets offline/restart/relocation needs without editing meeting originals or coupling identities to acoustic speakers.

Alternative 1, per-event manual history links only, stores less identity information but repeatedly asks users to link the same history and weakens attendee-linked continuity. Alternative 2, automatically merge display names/domains/cross-account emails or use external directory research, has unacceptable identity and scope ambiguity and is outside this issue. Putting portable metadata solely in the encrypted profile calendar vault would reduce plaintext exposure but lose library portability/account-free history associations; it would be a materially different storage design.

Sean accepted these concrete decisions on 2026-10-18:

1. **Identity:** initial reuse requires a user-confirmed exact identifier rule in the same library+calendar account; later exact matches may reuse that rule with visible provenance. No name-only, domain, alias, plus-address or cross-account merge. Historical bulk association is an explicit preview-and-confirm action. Same-address reassignment remains correctable; an address match is never a claim that someone spoke.
2. **Retention:** `calendar-context-v1.json` is local plaintext user content, moved with the library, containing names/addresses and correction history. Disconnect preserves it but removes its account from active brief access. No automatic deletion or background compaction; future vault encryption is separate. Offer explicit unlink/forget operations as described below.
3. **Cache/UX:** generated results are in-memory only, at most 16 entries/1 MiB total; restart requires regeneration. Open validates and presents metadata first; a visible Generate brief action starts inference. Wake revalidates locally and never starts model generation or provider refresh.
4. **Quality/limits:** shared DEV507 linked-history selection is bounded, not an exhaustive review. Above 256 selected meetings, require visible narrowing. Code renders coverage and source dates from `EvidenceBundle.meetings` (`occurredAt`, `dateBasis: startedAt | createdAt | unknown`); generated claims are not labelled verified. Apply the synthetic/model evaluation gates in the approved plan; parent coordinates independent review and Sean native QA.

These are approved implementation decisions. Minor defaults (panel layout, field bounds, stable sort, error copy) below are recommended implementation defaults and can be adjusted during review without changing scope.

## User experience

Coming Up gets a separate keyboard-reachable **Open brief** action. It sends only the canonical event ID. It does not invoke Take notes, recording.requestStart, engine start, Join, external links or an account login. Existing actions retain their behavior.

A resizable panel titled with event name/date shows account+calendar provenance, “On this device”, calendar last-successful-sync time and stale/offline indicator. It has:

1. **People and company**: invitees/organizer labelled “Invited” with observed address where available, matching provenance and a Review/Edit action. Self and resource entries are visible in a collapsed excluded group. Unknown self is labelled unknown; never silently excluded. Company is an optional user-created label, not inferred employer. Unknown/partial roster states are visible.
2. **History used**: confirmed eligible meeting links, each dated and labelled with how it was linked. Add prior meeting opens a local picker; a name/topic search can nominate candidates, but selecting a meeting is an explicit association. A compact selection summary reports selected/available counts. User may narrow by dates or selected meetings. Company history expansion is opt-in per brief, default off.
3. **Brief**: Generate brief, then progress/Cancel. Completed results show “Prior decisions and commitments”, original date badges, generated claim text and DEV507 source buttons. Conflicting records cite both dates; unknown dates say “Date unavailable”. A `startedAt` date is labelled as meeting date, a `createdAt` fallback as note-created date; neither is a promised deadline or proof a commitment remains unfinished. Any claimed deadline must be supported by original evidence.

Example copy: “Recorded on Oct 8: revise the proposal before the next review.” Never relabel it “Outstanding: revise proposal” without explicit current source support. No-history copy: “No linked local history yet. Review the people above or link a prior meeting.” Unknown identity: “We could not identify this invitee. Choose a person or link history for this event.” Failed scan: “Some linked history could not be checked. Retry or review the affected meetings.” These states are distinct; none says “You have never met.”

Editing a match offers **Choose another person**, **Leave unassigned**, **Not this person**, and optional **Use this exact calendar identity for future events**. Default edit scope is this occurrence. A separate explicit dialog can apply a rule to a previewed set of previously captured matching invitees; it shows count/date span and remains inside the same account/library. It never bulk-matches a display name. Person rename changes the local display label only; the observed invitee snapshot remains accessible as provenance. Company assignment is optional, effective from the edit forward; earlier meeting company associations do not silently change.

**Link prior meeting** supports event-only links when identity is unknown. Person/company links require choosing the target explicitly. A source from another calendar account can be manually selected only as an event-only local meeting link with visible “Linked by you” provenance; it does not merge people, import that account's directory, or grant source eligibility. A meeting with forbidden SourceScope remains inaccessible even if manually selected. This is an explicit local source association, not an automatic cross-account identity match; local source ownership remains independent of calendar connection.

Source actions use DEV507's original passage panel and keyboard return path; never model URLs or guessed audio offsets. Closing the brief cancels its run and restores focus to Open brief. If source navigation replaces the brief, keep only its safe view identity until it is reopened and validated. Cancel remains available while cleanup runs; Retry waits for native producer cleanup.

## Normalized observations and identity rules

Extend CalendarEvent with optional versioned `invitees` data. Existing cached records without it mean `unknown`, not zero attendees. Keep organizer separate and deduplicate into display entries only on a proven exact identifier within one event/account. Preserve roles as a set when one person is both organizer and attendee. Names are display-only. Resource attendees never become people automatically. Missing, invalid or duplicate identifiers produce ambiguous entries with no automatic association.

Recommended normalized bounds: 256 invitees/event; 256 Unicode code points/display name; 512/address or provider identifier; 64 KiB serialized observation. Overflow marks roster partial, with counts and a visible limitation; never treats omitted invitees as absent or silently treats partial data as complete. Control characters are removed only in the new normalized display fields; originals/raw meeting data are not rewritten. Address matching uses trimmed exact provider string, preserving local-part case; do not strip dots/tags, case-fold the local part, add aliases, or infer employer. Domains may be normalized for presentation but never company/identity inference. A case-only mismatch is reviewable, not auto-merged.

Google's `attendees[].self` refers to the calendar holding this event copy, and `attendeesOmitted` signals incomplete representation. Thus self alone does not identify the signed-in person on a shared calendar. A person identifier is optional provider data, not an excuse to query People/Contacts. [Google Events reference](https://developers.google.com/workspace/calendar/api/v3/reference/events).

Graph attendee objects describe an address and required/optional/resource role. `isOrganizer` describes the calendar owner, including delegated organization, so it is not an acoustic or authenticated-user identity assertion. Graph event IDs can change when moving containers; preserve current keys instead of promising move stability. [Graph attendee](https://learn.microsoft.com/en-us/graph/api/resources/attendee?view=graph-rest-1.0), [Graph event](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0).

Self classification is `confirmed-self | other | unknown` with evidence. An exact address against already verified authenticated owning-connection address metadata may establish confirmed-self (if existing metadata cannot prove address ownership, leave unknown); provider calendar-self needs that same ownership proof. An ordinary nonmatching address may be “other” only relative to known owning-account addresses; it is not proof that an alias isn't self, so user correction remains available. Shared/delegated/alias uncertainty defaults unknown. No new profile/contact fetch or expanded OAuth permission is needed. User “This is me” correction stays separate from provider evidence and never writes speaker participants.

Stable matching key preference: exact provider person ID when present and unambiguous, otherwise exact address, always namespaced by canonical library ID and existing opaque accountId. No identifying key means snapshot-local attendee ID only. A user-created person gets a random local UUID; it is not a hash of a name/address. Company UUIDs share the same scope and are user-created only. Existing confirmed rules apply only to new observations with exact unchanged keys; conflicting rules fail to unassigned. Negative occurrence overrides win over positive rules. Neither display renames nor addresses changed by a later sync replace the original provenance.

## Main-owned durable model

Add a private main module `calendar-context-store.ts`, backed by `<active library>/calendar-context-v1.json`. It is not stored under `meetings/`, not an extra SQLite writer and not a modification to the raw meeting-save schema. All IDs, revisions, timestamps and scope come from main. Renderer supplies bounded edit intents and expected store revision only.

Conceptual exact records (plain JSON; optional unknown fields preserved at every level):

```ts
type ContextFileV1 = {
  version: 1;
  scope: SourceScope; // canonical local library + null/null
  revision: number;  // increment only after successful atomic commit
  snapshots: Record<string, EventSnapshotV1>;
  people: Record<string, PersonV1>;
  companies: Record<string, CompanyV1>;
  changes: ContextChangeV1[];
};
type EventSnapshotV1 = {
  id: string; eventId: string; accountId: string; calendarId: string;
  provider: 'google' | 'microsoft'; providerEventId: string; occurrenceId: string;
  observedAt: string; eventDigest: string;
  subject: string; startIso: string; endIso: string;
  calendarLastSyncIso: string | null; calendarWasStale: boolean;
  roster: { state: 'complete' | 'partial' | 'unknown'; omittedCount: number | null };
  invitees: Array<{
    id: string; identifierKey: string | null;
    displayName: string | null; address: string | null; providerPersonId: string | null;
    roles: Array<'attendee' | 'organizer' | 'resource'>;
    self: 'confirmed-self' | 'other' | 'unknown';
    selfEvidence: 'authenticated-address' | 'owned-calendar-marker' | 'unknown';
  }>;
};
type PersonV1 = { id: string; accountId: string; displayName: string; createdAt: string };
type CompanyV1 = { id: string; accountId: string; displayName: string; createdAt: string };
type ContextChangeV1 = {
  id: string; revision: number; at: string;
  supersedes: string | null;
  provenance: 'user' | 'accepted-start' | 'confirmed-rule';
  payload:
    | { op: 'bind-invitee'; snapshotId: string; inviteeId: string; personId: string | null }
    | { op: 'exclude-person'; eventId: string; identifierKey: string; personId: string }
    | { op: 'set-rule'; accountId: string; identifierKey: string; personId: string | null }
    | { op: 'set-company'; personId: string; companyId: string | null }
    | { op: 'link-meeting'; meetingId: string; target: ContextTarget;
        snapshotId: string | null; sourceRevisionAtLink: string; originalHashAtLink: string;
        companyIdAtLink: string | null }
    | { op: 'unlink-meeting'; linkChangeId: string }
    | { op: 'set-self'; snapshotId: string; inviteeId: string; isSelf: boolean }
    | { op: 'rename'; entity: 'person' | 'company'; id: string; displayName: string };
};
type ContextTarget =
  | { kind: 'event'; accountId: string; eventId: string }
  | { kind: 'person'; personId: string }
  | { kind: 'company'; companyId: string };
```

Scope is file-wide; every person/company/event reference is validated against that scope and account. Main validates change references and expected revision before serialized commit. A rule produces concrete bindings when a future snapshot is captured; it does not retroactively reinterpret old snapshots. Historical matching uses the explicit preview/batch edit and creates concrete changes for each selected snapshot. Corrections append superseding records; the deterministic current view folds changes in revision order. Revisions and immutable original fields are not rewritten to make a correction appear historically observed.

Snapshot IDs are UUIDs. Snapshot content digest hashes fixed canonical serialization of brief-relevant normalized fields, excluding observedAt/lastSync time. Unchanged observations reuse a snapshot; new content makes a new one. Existing meeting links keep their original snapshotId; a later roster edit does not revise attendance history. An occurrence override follows to a newer snapshot only if its exact identifier is unchanged, with a new user-provenance change referencing its superseded change; otherwise it becomes a review item. Company membership at link time stays fixed until explicit history correction.

Write with a private unique temp file, mode 0600, fsync, read/schema-check, atomic rename; publish in-memory revision only after success. Serialize in one main owner under libraryActivity. Unsupported versions, malformed scope/content, conflicting external file edits or unreadable file fail closed and preserve bytes. Do not silently reset/reformat corrupt metadata. Compare previously read file digest before commit to reject an external lost update. Unknown richer fields round-trip. A missing file is initialized only after the existing source worker provides a canonical identity; this module never creates/repairs the marker.

Recommended sidecar hard admission bound: 16 MiB. At the limit, reads remain available and explicit forget can reduce size; new captures/associations report capacity and do not silently prune history. No hidden background retention. Explicit **Forget saved calendar context for this account** can remove that account's sidecar snapshots, rules, people/company and link history after showing the affected count; it must not delete original meetings/audio or disconnect credentials. It is an optional separate user action, never triggered by ordinary disconnect. Concurrent change aborts the forget preview and requires a fresh preview. This is the only deliberate deletion path; ordinary correction/unlink retains provenance.

Add exactly this filename to `LIBRARY_ENTRIES`; moving the library carries observations and corrections, not calendar tokens. Same library UUID at a different realpath gets fresh runtime fences. Metadata from a different scope is withheld, never automatically rebound. The file provides local persistence, not sync/export permission or encryption. Older binaries ignore it and their older relocation allowlist may leave it behind; document preservation before downgrade relocation. Rolling back the feature retains this file and all originals, and drops only the in-memory generated cache.

## Capturing calendar starts without changing speakers

On **Open brief**, capture the currently resolved event observation for its metadata/review view. No meeting is created and no recording starts. Merely opening does not create a person rule or historical person link.

On an accepted calendar recording start, capture a main-only immutable observation and account/library/lifetime fence attached to the coordinator's request ID. The payload sent to renderer need not carry the roster. All routes already converge on requestRecordingStart: Home, banner, native floating panel, OS notification and mic-correlated calendar prompt. Ad-hoc requests have no calendar snapshot. Retain an internal request→snapshot binding until cancellation/failure or the engine-start boundary.

Do not commit a meeting association at `recording.attach`: a newly reserved meeting does not exist yet. When main accepts the live engine start and then receives the matching `started` event, validate the created/reused original's ID, non-trash/eligible scope and canonical calendarEventId against the accepted request; commit the link with the captured snapshot and original revision/hash. Bind this to the actual capture ID so a superseded callback cannot attach to the next meeting. No renderer-supplied roster, account, snapshot, arbitrary raw path or inferred speaker identity is trusted.

For existing notes already linked with a retained snapshot, preserve that link on Resume/reopen. Existing notes without snapshot provenance do not gain historical invitee assertions from today's roster: offer an explicit link during review. Record in main whether the meeting already existed at attach. Automatic accepted-start history linking is limited to a newly created original or an already established exact snapshot association. A new capture on an existing note without provenance may retain its event observation, but must not automatically make that note's entire earlier content part of a person's history; explicit review is required. Unique proven legacy alias reuse still follows the existing main resolver and exact event migration only. Ambiguous aliases stay unassigned.

Optional sidecar persistence failure must not interrupt an otherwise valid recording or rewrite its meeting. Show a non-blocking “Calendar context wasn't saved; history may need linking” notice. Queue bounded metadata work without blocking audio capture; retain the immutable context until its atomic write resolves, with the library activity lease covering persistence. This addition requires real lifecycle regression tests across all routes; it does not claim DEV114 auto-seeding exists.

## Shared DEV507 seam

DEV507 and DEV509 design owners agreed on one main-owned `CitedAskService`. DEV509 does not implement another source ranker, prompt builder, inference engine, citation validator, source UI or Home-chat persistence path. The exact shared declarations are owned by [DEV507 DESIGN](./2026-10-18-dev507-cited-ask-design.md), sections “Exact additive contracts” and “Generation, freshness and lifecycle”; the following is the agreed caller shape (orchestration pseudocode, not product code):

```ts
const request = {
  purpose: 'calendar-brief',
  selection: { mode: 'linked-history', meetingIds: explicitLinkedIds, topic: optionalUserTopic },
  context: { templateVersion: 1, eventText: boundedUntrustedEventContext },
  consumerRevision: currentBriefDependencyDigest
};
const control = {
  ownerId: mainDerivedOwner, runId, signal, onProgress,
  assertCurrent: () => assertBriefFenceCurrent(capturedFence)
};
const result = await citedAsk.run(request, control);
assertBriefFenceCurrent(capturedFence);
if (result.status !== 'error') {
  const currentRequest = await resolveCurrentBriefRequest(briefSessionId);
  assertBriefFenceCurrent(capturedFence);
  const validation = await citedAsk.validate(result.snapshot, currentRequest, control);
  assertBriefFenceCurrent(capturedFence);
  if (validation.status !== 'valid') return withholdAndReport(validation);
  // Only now admit the CitedAnswerSnapshot to the owner view/cache.
}
// resolveCitation(snapshot, evidenceId, currentRequest, control) revalidates on click.
```

The brief request always contains an explicit subset. `[]` is no-history, with no scan-wide fallback and no model call. Main deduplicates/checks IDs; >256 unique IDs produces shared error code `narrow-history`, never truncation/filter removal. Malformed or noneligible membership follows shared `invalid-subset`/`unauthorized`/`unavailable` handling; UI may say “Narrow history” or identify a missing link but does not invent an alternate service code. Unknown/trashed/unauthorized/unavailable IDs remain distinguishable from honest empty. `linked-history` selects bounded originals even if attendee names or “decision” never appear in their text; optional topic only boosts relevance. The shared deterministic policy, `scanComplete`, `selectionComplete`, prompt `budgetComplete`, actual wire-included ranges and local model artifact revision are returned separately. Claims reference only exact `prompt.ranges[].id`; each has its retrieval `parentRangeId`, and shortening creates a new deterministic range ID. No retrieved-but-omitted range is citable. Head/middle/tail and per-meeting balancing improve coverage but do not guarantee every historical commitment is found. DEV509 uses a strict admission policy: if an incomplete scan cannot establish a valid complete dependency domain, final validation withholds the generated brief and reports history-unavailable with Retry or explicit narrowing. Retrieval sampling/budget omissions are different: a complete validated domain can still produce a visibly limited brief. DEV509 does not present a partial-scan generated result merely because run() returned it.

DEV509 rederives linked meeting membership on every open/wake/refresh from the current sidecar and current original availability. It uses trusted meeting metadata only to nominate IDs; final eligibility and raw/projected revisions belong to DEV507. Do not silently remove unavailable/trashed/wrong-scope linked IDs to manufacture []; requested linked membership and each blocked state remain explicit. [] means there are genuinely no selected links, not that every linked source failed validation. Restored/imported originals are nominated automatically only for an already captured exact meeting-ID association whose canonical event link still agrees; a new meeting ID or ambiguous imported event reference requires explicit linking. Final source eligibility is always rechecked; no-history does not permanently cache absence. A new explicit link or captured association changes the subset digest even after cached no-history; restoring an already linked original changes source availability/manifest and clears its prior unavailable state after validation. Display-name/title search never silently changes membership.

Event context contains only bounded title, date and user-selected labels/topic, marked untrusted and never cited as history evidence. Avoid sending addresses/provider IDs to inference when display labels suffice. Prior brief output and generated summaries are not factual evidence. DEV507 owns exact original text/range checks and local execution policy; global cloud settings cannot route this request to a provider. SourceScope stays canonical null/null. Service never writes global-chat; DEV509 stores only its ephemeral result.

## IPC and lifecycle

New `shared/briefs-api.ts` exposes bounded intents:

- `open({eventId}) → BriefView`: main validates current visible event, connected account and active library; returns an opaque briefSessionId, safe metadata, history states and edit revision.
- `edit({briefSessionId,expectedRevision,change}) → BriefView`: main derives account/scope/event and validates allowlisted edit payload/references; no raw file or scope accepted from renderer. Batch previews use an opaque expiring previewId bound to exact revision and ID list.
- `generate({briefSessionId,runId,selection,topic?}) → BriefRunResult`: selection can narrow main-known history only, never widen arbitrary hidden sources. An explicit event-only Add prior meeting goes through the validated picker/link operation first.
- `refresh({briefSessionId}) → BriefView`: local event/source reconciliation; no provider network. Existing Sync calendar remains a separate calendar action. Refresh may offer Generate again after validation; it never invokes inference implicitly.
- `cancel({briefSessionId,runId})`, `close({briefSessionId})`: cancellation outside the relocation barrier; owner is main-derived webContents+session, not renderer-supplied. Destroy/reload closes owned sessions.
- `onState`: owner/session/run-scoped progress/result/status only. No raw unvalidated generated tokens.

`BriefService` owns sessions and cache. `CalendarContextStore` owns durable records. A trusted CalendarService resolver returns event snapshot plus connection epoch, selection generation and local calendar revision; its event/account changes notify BriefService. `index.ts` adds Electron powerMonitor resume routing to invalidate all cached brief admission and revalidate open briefs. This work does not initiate provider sync on wake or touch the parent's running QA app.

States: resolving → review-ready/no-history → retrieving → preparing-local-model → generating → checking-sources → ready. Alternatives are identity-unknown, roster-partial, history-unavailable, narrow-history-required, model-missing, model-busy, model-failed, output-invalid, canceled/cancelling, stale, account-disconnected, event-unavailable, library-unavailable and context-save-failed. State messages keep correction/history controls available when safe. Missing model opens existing settings only after user action and never downloads automatically. No-history skips model readiness entirely.

## Freshness and cache rules

Cache key is `canonical scope + eventId + selected history mode/IDs + topic/template version`; lookup alone never permits display. A main-private admission manifest adds realpath/library lifetime, connection lifetime and selection epoch, normalized eventDigest, relevant correction/history-link revisions, model artifact/policy, and DEV507's full source/selection snapshot. Do not use observedAt or process worker generation as a durable content revision.

DEV507's source snapshot covers **all selected originals**, including uncited ones; raw SHA256 and projected revision, inventory/eligibility/filter descriptor, complete coverage, actual model-wire ranges and budget/model identities. DEV509's consumerRevision additionally covers current membership/event/corrections. Content-identical reindex can validate equal; new/removed/edited originals or changed selection cannot reuse stale content. Raw hashes and projected citation revisions stay separate.

Every open, explicit Refresh and wake first hides generated claims/quotes, invalidates pending admission, re-resolves current event/account/library and rederives membership. Then shared validation reconciles the current descriptor/inventory and exact originals. Equal manifests may reuse a generated answer; changed manifests show stale and offer regeneration. Validated empty history may render no-history immediately. Shared `no-history` and `insufficient-evidence` return real CitedAnswerSnapshots with full evidence manifest/coverage and empty claims. A non-generated result has null prompt/engine/model; a generated abstention retains its actual metadata. Validate these snapshots through the same current-request API, always rederiving membership first; never invent a scope-wide empty lookup. Failure/incomplete reconciliation never becomes clean empty. While checking/stale/unavailable, only event metadata freshly resolved as accessible in the current context and status are shown; cached quotes are not a revocation bypass. Disconnect/scope loss withholds the old event title and attendee names too, leaving a generic unavailable state.

Relevant source writes, correction edits, event/roster/reschedule changes, account removal/reconnect, calendar visibility change, settings/model changes and library relocation invalidate runs immediately. Before and after every await and before admission, compare owner/run+consumer revision and all main fences. Source may change outside the app; validate before inference, admission and every citation click. This is observed-time validation, not an atomic filesystem snapshot guarantee.

Disconnect cancels/evicts that account's sessions/derived cache immediately and withholds saved person context from other accounts. Original local meetings stay available through ordinary eligible library browsing. Reconnect to the same verified account may expose retained corrections after revalidation under a new lifetime fence; reconnect to a different identity cannot. Sign-out from DoodleNote cannot rewrite local SourceScope or make local source history require sign-in.

A failed calendar refresh retains stale cached event context with last-sync time; it cannot prove event cancellation. Successful removal/cancellation or the event leaving the visible/upcoming set makes the current brief unavailable, with no automatic identity transfer to another occurrence. An event whose time changes but canonical ID remains stable gets a new content digest; distinct occurrence IDs stay distinct.

Memory cache is LRU with 16 entries/1 MiB serialized-answer budget; a result larger than capacity may stay in the current validated view but is not cached. A shared in-flight operation is never reused across owners; busy model work gets a clear retry state. Eviction discards only generated material. Restart has no generated cache. No background generation, speculative multi-event fan-out or unbounded queued model jobs.

## Compatibility and rollback

Existing original text/transcripts/audio, participants, richer mobile fields, sourceScope, selected summaries, attachment/audio-failure metadata and raw-save behavior are byte-preserved unless the existing user action intentionally edits them. The brief feature adds no fields through `MeetingFileStore.updateText` and never saves an untouched original when viewing citations. Calendar cache fields are optional; old events remain readable with roster unknown. Missing local models affect only generation.

Keep recipe/cloud guards, source-anchor versions, canonical identity writer and existing account vault encryption unchanged. Gating off the brief feature disables its entry/service/capture adapter, preserves the sidecar, and evicts memory results. Additive fields round-trip without destructive migrations. There is no generated-answer migration or permanent new index. Downgrade/relocation limits are documented, and rollback does not erase user corrections.

## Review status

Independent design review resolved partial-scan admission (incomplete means unavailable), validation of every non-error/empty snapshot, and inherited correction provenance using user + supersedes. Sean approved the final design and stacked execution on 2026-10-18. Implementation and test results are recorded separately; this spec is not evidence of passed QA.
