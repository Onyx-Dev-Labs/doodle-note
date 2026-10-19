# DEV-507 cited local library Ask — approved implementation design

2026-10-18. **Approved implementation target; not yet benchmarked or delivery-qualified.**

2026-10-18 decision: Sean explicitly approved both designs and stacked implementation above PR230 at bbb352bd96fc60b504ecf73793f6ea4564c54d16. This supersedes historical unapproved and prerequisite-landing-before-edit wording. Final stack merge order, CODEOWNER/human review, quality and native QA gates remain; no merge or release authority. DEV507 implementation uses t3/answer-library-questions in the exclusive t3-d30e320c worktree; DEV509 integrates the tested shared service. Parent owns independent reviews. Inspected clean integration `/Users/sean/.t3/worktrees/doodle-note/t3-fd27af2f` at `bbb352bd96fc60b504ecf73793f6ea4564c54d16`. No source, tracker or PR mutations. Root checkout remains untouched.

## Evidence and decisions

The full starting report and probe results are `/tmp/dev507-research.cmUJjB/DEV507-readiness-plan.md`, `HANDOFF.md`, `probe-results.json`; the consumer critique is `/tmp/dev509-research.YxxO2E/DEV507-SEAM-REVIEW.md`. Reuse their synthetic evidence, do not count it as new testing. The original research recorded Backlog/unassigned and prerequisite landing gates; the dated decision above supersedes those implementation prerequisites. No merge or native acceptance is implied.

Verified delta from research SHA `63d2a588...`: Fetches user-facing terminology; canonical coverage-paragraph de-duplication in NotesService; local native runtime acquisition/CPU retry diagnostics, `build:'never'`, and tests. No retrieval/source contract changes. Existing deadline/cleanup and busy flags remain useful but are not newly implemented by DEV507. The main source service still has no trusted retrieval method; worker/client live in `packages/meetings-store`, not desktop main. SourceSnapshot fingerprints are stat fingerprints, **not raw content hashes**. New raw SHA-256 manifest data must be computed during the existing read, independently of v1 projection revision.

Read `CONTRIBUTING.md`, `.github/CODEOWNERS`, `docs/global-ask-budget.md`, `packages/meetings-store/README.md`, `docs/recipes.md`; no applicable AGENTS.md found along the checkout's ancestor path or affected packages. Follow Node 22+ (SQLite >=22.13), frozen lockfile, synthetic data, CODEOWNERS @seaninman/@alectribble and required CI/native QA. Fetches internal recipe schema/API remain unchanged and all cloud fetch execution stays disabled.

**Routine implementation decisions within scope:** additive source APIs; v1 anchors unchanged; worker-owned I/O/identity/index; pure shared retrieval planner; local-only on-device model; no download/network fallback; explicit subset semantics; caller-owned persistence; range validation; original-panel navigation; request-owned cancellation; atomic history writes and compatibility guard. Date/folder filtering uses existing identity only. These do not need separate user approvals.

**Accepted contract targets:** generated-claim/original-source UI, lexical-first recall limits, linked-history sampling/caps, v1 truncated lists and the quality thresholds below. Parent coordinates human review and QA. Local-only is the requested scope; exposing a local-model requirement while global Settings selects cloud needs clear UI, not cloud permission. Changing thresholds after evaluation must be recorded and reviewed, never quietly relabeled a pass.

## Behavior and retrieval

New cited Home Ask always says “On this device” and uses a cached on-device model even when global Settings selects a cloud provider. If no local model is ready, it retains the question and offers Open Settings; it never downloads automatically or falls back to old cloud Ask. It defaults to the whole eligible local library, and shows explicit date/folder filters. No implicit newest-30 scope and no person filter until confirmed identity exists. A question produces generated claims plus source buttons and deterministic coverage. No prior chat is fed into v1 inference; previous answers are never evidence. “Outstanding todos” becomes “Find past action-item mentions”; dated mentions do not establish current task status.

One `retrieveEvidence` worker call reconciles the full eligible scope before ranking. Refactor the current `DerivedSourceIndex.search` reconciliation into a private reusable operation; retain old search ordering, literal AND semantics and response shape exactly. Candidate lookup may use FTS OR terms, but all candidate originals undergo the shared predicate/ranker before any cap. Do not combine capped per-term searches. Read-only MCP uses the same pure ranker over its direct scan, no SQLite/native import, no identity write.

Question planner v1: at most 16 unique normalized Unicode letter/number terms, retain quoted phrases (at most 4), drop a checked-in small English question/stop-word list; retain single-character non-Latin terms and quoted stop words. Record omitted terms. Positive original term/phrase match required; empty/punctuation/stopword-only plans return `refine-query`. Score original windows lexicographically by phrase-match count, distinct query-term coverage, then sum `log(1 + N/(1+df(term)))`; stable meeting/source/range keys break ties. `N`/df use eligible filtered originals before capping. Titles/selected summaries may boost a meeting already containing matching originals; they never supply factual evidence or conjure support for a summary-only match. No stemming/synonyms/embedding or semantic-recall claim.

Build match-centered windows <=1,600 Unicode code points, expose half-open UTF-16 offsets into the unmodified resolved passage, and deduplicate overlap. Never truncate original storage or replace canonical speaker labels. Limit to 64 candidate windows, 24 selected windows, 4 per meeting; record each limiting reason. Require a complete scan of the requested eligible source domain before any model invocation or non-error Ask snapshot. A source-unavailable state offers retry or explicit narrowing; lower-level retrieval/count APIs may expose clearly labeled partial evidence or observed lower bounds without producing a generated answer. 15s retrieval deadline returns `retrieval-timeout`, no complete-empty result. Cancellation checkpoints surround file reads/ranking/SQL; a synchronous file/SQL operation may finish first.

Calendar `linked-history` mode requires a main-validated subset and does not require topic/name matches. For each meeting, enumerate original personal/transcript windows in source order with <=1,600 code points; order representative candidates tail, head, middle, then remaining windows by stable source/range key. A topic-matching window takes the first slot when available, followed by the representative order with deduplication. Round-robin meetings newest first (date then meeting ID) across each slot before 64/24/4 caps. This intentionally bounded sampling does not promise every late commitment or every linked meeting reaches the model. Coverage says how many meetings/windows were omitted; no-history is reserved for explicit [] or a complete known subset with no original passages. DEV509 can require the user to narrow history when sampled evidence is insufficient. This mode needs the explicit quality review below; it is not a wildcard substitute for question search.

Normalized subsets deduplicate then cap at 256; input payload cap is 512 IDs before deduplication. [] never widens to library. Validate each ID syntax/eligibility and return invalid-subset/unavailable distinctly for unknown, trashed, wrong-scope or unreadable records; do not silently drop them. Home omitted subset means all eligible. Date uses valid startedAt then valid createdAt; if neither exists, count `unknownDateCount` under a date filter. UTC inclusive start/exclusive end; UI displays local boundary labels. Folder/date descriptors are scan metadata, never v1 revision semantics.

Counts are a separate deterministic `census` operation for explicit `eligible` or literal-AND predicates. Never translate model SQL or infer semantic task counts. Return complete observed meeting/source counts before display cap, show up to 100 matching meeting identities and `listTruncated`; no cursor in v1. Partial/unavailable scans return nonexact totals labeled observed lower bounds. Free-form count/all questions get retrieved examples plus “This is not an exact total”; the UI offers an explicit Count matching text action with its visible literal predicate. Source counts are passage matches, not decisions/tasks. `unavailableCount` means unavailable source units and may include missing selected-summary material, not necessarily distinct meetings.

## Exact additive contracts

Additive export `@repo/meetings-store/evidence-contract`; all existing exports remain. Arrays below are JSON-serialized; timestamps ISO UTC; IDs are opaque data, not paths. SHA fields are lowercase SHA-256 strings. Serialized objects must receive strict runtime validation.

```ts
import type { SourceScope, SourceAnchor, SourcePassage } from './source-contract'
type EvidenceFilters = { folderId?: string; dateFrom?: string; dateBefore?: string }
type EvidenceSelection =
  | { mode: 'question'; question: string; filters: EvidenceFilters; meetingIds?: string[] }
  | { mode: 'linked-history'; meetingIds: string[]; topic?: string }
type EvidenceRange = {
  id: string; anchor: SourceAnchor; startUtf16: number; endUtf16: number; quote: string
} // kind must be personal/transcript; id hashes anchor+range+exact quote
interface EvidenceCoverage {
  version: 1; scope: SourceScope; observedAt: string; selection: EvidenceSelection
  terms: string[]; phrases: string[]; droppedTerms: string[]
  eligibleMeetingCount: number; scannedMeetingCount: number; matchingMeetingCount: number
  matchingSourceCount: number; candidateWindowCount: number; selectedMeetingCount: number
  selectedRangeIds: string[]; unavailableCount: number; unknownDateCount: number
  scanComplete: boolean; selectionComplete: boolean; semanticCoverage: 'not-exhaustive'
  omissions: Array<'query-terms'|'candidate-cap'|'range-cap'|'meeting-cap'|
    'unavailable'|'changed-during-scan'|'unknown-date'|'linked-sampling'>
}
interface SourceDependency {
  meetingId: string; rawSha256: string; projectedRevisionId: string
  filterMetadataSha256: string
}
interface EvidenceManifest {
  version: 1; scope: SourceScope; pathBindingSha256: string
  selection: EvidenceSelection; plannerVersion: 1
  inventorySha256: string; dependencies: SourceDependency[]
  selectionSha256: string; coverageSha256: string
}
interface EvidenceMeetingMeta {
  meetingId: string; title: string; occurredAt: string | null
  dateBasis: 'startedAt'|'createdAt'|'unknown'
}
interface EvidenceBundle {
  version: 1; ranges: EvidenceRange[]; meetings: EvidenceMeetingMeta[]
  coverage: EvidenceCoverage; manifest: EvidenceManifest
}
type CensusRequest = { filters: EvidenceFilters; predicate:
  { kind: 'eligible' } | { kind: 'literal'; text: string } }
interface CensusResult {
  scope: SourceScope; predicate: CensusRequest; meetingCount: number; sourceCount: number
  exact: boolean; unavailableCount: number; unknownDateCount: number
  meetings: Array<{ meetingId: string; title: string }>; listTruncated: boolean
}
```

`candidateWindowCount` counts every distinct eligible window before 64/24/4 selection limits. `selectionComplete` means every such candidate window was returned intact in `EvidenceBundle.ranges`; it is independent of `scanComplete`, and never means semantic completeness. For linked-history, representative-only sampling sets `selectionComplete=false` whenever any eligible original window is omitted. `selectedRangeIds` names exactly these retrieval ranges, never the later wire ranges. No statement of completeness follows when either boolean is false.

Main-only types in `apps/desktop/src/main/cited-ask-service.ts` import the contract and shared serializable answer types. Trusted callbacks never cross IPC.

```ts
type CitedAskRequest =
  | { purpose: 'library-ask'; selection: Extract<EvidenceSelection,{mode:'question'}> }
  | { purpose: 'calendar-brief'; selection: Extract<EvidenceSelection,{mode:'linked-history'}>;
      context: { templateVersion: 1; eventText: string }; consumerRevision: string }
type AskProgress = 'queued'|'retrieving'|'preparing'|'generating'|'validating'|'cancelling'
interface AskControl {
  ownerId: string; runId: string; signal: AbortSignal
  assertCurrent(): void // caller's event/account/correction fence; throws when changed
  onProgress?(phase: AskProgress): void
}
interface CitedClaim { id: string; text: string; kind: 'paraphrase'|'quotation'|'conflict'; evidenceIds: string[] }
interface PromptEvidenceRange extends EvidenceRange { parentRangeId: string }
interface PromptInclusion {
  ranges: PromptEvidenceRange[]; omittedRangeIds: string[]; budgetComplete: boolean
  inputTokens: number; contextWindowTokens: number; outputReserveTokens: number
  safetyMarginTokens: number; accounting: 'tokenizer'; wireSha256: string
}
interface CitedAnswerSnapshot {
  version: 1; runId: string; purpose: CitedAskRequest['purpose']; askedAt: string
  status: 'answered'|'conflicting-evidence'|'no-history'|'insufficient-evidence'; claims: CitedClaim[]
  evidence: EvidenceBundle; prompt: PromptInclusion | null
  engineId: string | null; modelArtifactRevision: string | null; promptVersion: 1
  consumerRevision?: string
}
type CitedAskResult =
  | { status: 'complete'|'no-history'|'insufficient-evidence'; snapshot: CitedAnswerSnapshot }
  | { status: 'error'; code: 'cancelled'|'busy'|'refine-query'|'invalid-subset'|
      'narrow-history'|'unavailable'|'retrieval-timeout'|'model-absent'|'model-failed'|
      'question-too-large'|'unsupported-model-budget'|'output-limit'|'invalid-answer'|
      'stale'|'unauthorized'; message: string }
type SnapshotValidation =
  | { status: 'valid'; observedAt: string }
  | { status: 'stale'|'missing'|'unauthorized'|'unavailable'; reason: string }
type CitationView =
  | { status: 'resolved'; passage: SourcePassage; range: EvidenceRange;
      audio: { status: 'available'; token: string } | { status: 'unavailable'|'ambiguous' } }
  | Exclude<SnapshotValidation,{status:'valid'}>
interface CitedAskService {
  run(request: CitedAskRequest, control: AskControl): Promise<CitedAskResult>
  validate(snapshot: CitedAnswerSnapshot, currentRequest: CitedAskRequest, control: AskControl): Promise<SnapshotValidation>
  resolveCitation(snapshot: CitedAnswerSnapshot, evidenceId: string, currentRequest: CitedAskRequest, control: AskControl): Promise<CitationView>
  cancel(ownerId: string, runId: string): Promise<void> // resolves after producer cleanup
}
```

Runtime schema couples result/snapshot statuses: complete carries answered/conflicting-evidence; no-history/insufficient-evidence carries the matching status and empty claims. Non-generated snapshots still carry full coverage+manifest and have null prompt/engine/model; generated abstentions can retain their actual prompt/model metadata with empty claims. Thus cached empty results can be validated against the current caller descriptor without invoking the model or widening the subset. Every non-error snapshot, including no-history and insufficient-evidence, requires current-request validation before display or cache admission. Home may show a validated non-answer state without saving a chat exchange; DEV509 may cache its validated explicitly empty state. All non-error snapshots require scanComplete=true. An explicit empty subset is a complete empty requested domain only after current scope and caller descriptor validation; it never requires or authorizes a full-library scan.

`run` never persists. Home's controller owns history; DEV509 owns its event cache. `assertCurrent` must be called before/after every awaited shared operation and immediately before return; caller still validates before its own atomic commit/display. A calendar context is at most 4,096 UTF-16 units, escaped untrusted context, never evidence; template/purpose are validated enums. Question <=4,096 UTF-16 units matches existing query boundary; reject rather than truncate. IDs <=64 ASCII existing source syntax. New renderer IPC obtains owner from sender, accepts only runId/question/filters or saved entry+citation IDs; renderer cannot inject scope/path/manifests. DEV509 calls this main service with its own trusted context, not Home IPC.

Manifest inventory hashes the sorted scan inventory including exclusion/unavailable markers and filter metadata; dependencies include every eligible matching-domain original that could affect ranking, not just selected/cited sources. Question mode includes the entire eligible filtered set; linked mode includes every explicit subset member and a descriptor digest. For linked cached no-history, DEV509's consumerRevision must include the resolved subset/correction revision; [] itself cannot discover a newly linked meeting. Validation compares the current request (including consumerRevision) with the stored descriptor, reruns caller linkage then shared reconciliation; a changed subset must stale old result. Meeting dates in the bundle are read from originals with explicit unknown, never supplied by the model. No raw filesystem path enters renderer/MCP or persisted JSON; pathBindingSha256 separately fences canonical realpath. Raw hashes never replace projectedRevisionId. Stable range/selection hashes ignore timestamps/run IDs. Cache rebuild alone with identical content and projection semantics remains valid; selection-policy/projection-version changes invalidate. New/deleted/changed uncited inputs invalidate. An incomplete scan or unreproducible dependency domain returns unavailable before model invocation and produces no non-error Ask snapshot. No generated partial answer is admitted live or cached. If reconciliation becomes incomplete after generation, validation returns unavailable, withholds the answer, and saves nothing. Complete scans with selectionComplete=false or budgetComplete=false may generate and be displayed/cached after successful current-request validation, with explicit selection/budget omissions; those omissions do not make the source-domain scan incomplete.

## Generation, freshness and lifecycle

Add optional `NotesEngine.askWithEvidence(input, control)` and a pure `buildCitedAskPrompt(input,budget)` in AI. AI accepts a narrow structural DTO (evidence ID/quote/labels/ranges and coverage text), avoiding a runtime dependency on meetings-store. Main maps its bundle to DTO. Output is raw structured JSON plus actual `PromptInclusion`; the model does not supply provenance metadata. Local engine allocates context first and counts complete exact system/user/wrapper with the loaded tokenizer. Preserve 4,096 output reserve + 256 safety and the existing deadline/disposal/CPU retry rules. `NotesService.runCitedAsk` selects `pickEngine(true,true)`, captures model file identity/settings revision, shares ask/enhance/activate busy ownership, and holds it through cleanup. Never call generic cloud-selected Ask or `prepare()` without the validated cached modelPath. No HTTP/DNS/provider fallback, downloads or dynamic runtime builds.

Pack whole windows by rank; if needed shrink around the match and recompute exact range/id, then recount whole request. Return the exact wire-included ranges after reductions. Every prompt range has `parentRangeId` identifying its retrieval range. An unchanged window keeps its deterministic ID; a shortened window gets a new anchor+range+quote hash. Claims cite only `prompt.ranges[].id`; validation proves that each exact prompt range is contained in its declared parent and current original. `omittedRangeIds` lists retrieval windows with no wire inclusion; `budgetComplete` is true only if every retrieved window was included unchanged. UI reports scan completion, retrieval selection and prompt budget separately; the renderer never treats retrieval selected IDs as permission to cite omitted text. Question and schema are never shortened. No useful fitting range means insufficient evidence without inference. Use no prior exchange history. Sources and event text are JSON-escaped data; fixed system forbids treating them as commands. No model tools, filesystem paths, arbitrary URLs or action callbacks exist. Output is <=12 claims, <=4 refs per claim; every claim requires refs; unknown IDs/invalid ranges/malformed JSON fail with no save. Quotation text is sliced in code, not trusted model bytes. A paraphrase remains generated: quote membership is not entailment. No raw answer token streaming; emit run-scoped phases, publish only validated output.

Register run+AbortController before barrier/readiness. New per-request client cancellation races readiness and retirement, sets worker atomic flags and fences delayed callbacks without invalidating other requests. Keep worker completion acknowledgement separate from UI abort acknowledgement; canceled work drains before release/retry. Do not terminate the shared worker to cancel one caller. One producer owns model busy state across Home/brief/summary/Fetches. Cancel IPC bypasses relocation barrier, verifies sender/run; writes, identity/path/model-policy changes and owner teardown abort relevant runs. A run queued behind relocation can cancel without entering the barrier. Native cleanup remains awaited; a slow producer leaves visible Cancelling instead of pretending idle.

Require scanComplete=true and a validated current dependency domain, then reconcile/validate all selected originals before inference, dependency manifest and exact prompt citations before completion, then caller validates scope/run/history/event epochs before its atomic commit. Any failed post-generation freshness check returns stale/unauthorized/unavailable and stores no answer; it leaves all previously persisted history intact. It never clears history as error recovery. Revalidate on history open/wake and every citation click. External editors are not locked; this is observed-at validity, never an atomic filesystem snapshot. No substitution of newer revisions. Unauthorized/scope-mismatched, checking, missing or stale cached answers withhold claim/source content and show state/retry. New source staleness needs retrieval, not only old citation resolution.

## UI, persistence and rollback

Cited Home history uses legacy array `global-chat.json` with optional `citedAnswer`. New entry's fallback `answer` is a safe generic message (“Open this answer in a version with cited Ask support”), not copied sensitive model content; this prevents an older binary displaying unvalidated claims from new entries. Current renderer uses validated structured content. Preserve legacy question/answer/time and unknown keys; label legacy answers “Earlier answer · sources not recorded”; never reuse them as grounding. Invalid richer history fails visibly and blocks overwrite; atomic temp+fsync+rename with serialized writes, run-ID idempotence and clear-history epoch. Unsupported entries stay intact. All new source text is derived sensitive local data, not encrypted by this change. No original meeting writes. Rollback preserves history/identity/originals; disable the new UI/service feature gate and keep existing APIs. Do not silently send new wider evidence to the legacy cloud route.

Home controller persists complete validated results only, passes coverage immediately into rendered entries and reports save failure distinctly. Calendar never creates Home entries. Source controls use server-owned anchors; Original passage panel shows title/date, kind, canonical speaker, exact quote and status. Transcript rows focus by original segment ID and revision; personal line IDs display original Markdown in the read-only panel rather than unreliable editor DOM offsets. Opening a source must not flush/save an unchanged editor. Keyboard focus returns to originating citation; source statuses are announced.

Audio is a separate explicit action, never autoplay. Main resolves actual original segment + audio part + availability into an opaque short-lived token; Play validates again and uses existing trusted audio APIs. Plain startMs is insufficient. Disable ambiguous multi-part mapping; imports/missing/deleted audio show unavailable. No model-supplied href/path or fabricated timestamp. UI states distinguish incomplete scan (“Sources unavailable” with retry/narrow and no generated answer), no match/history, omitted evidence, model absent/failure, output limit, source change, unauthorized and save failure. Narrow/wide, light/dark, keyboard and screen-reader checks are required.

## Acceptance and review gates

| Contract | Test/evaluation evidence required |
|---|---|
| Older 500+ library/detail absent from summaries | Existing 601 synthetic pattern extended to giant late segment; 20 must-find literal questions all place exact gold range on actual prompt wire; broader 40 answerable lexical questions gold recall@24 >=95%. No synonym-only claim. |
| Exact typed/transcript/audio navigation | Every emitted fixture citation resolves exact UTF-16 slice; repeated text/Unicode/legacy IDs/canonical speaker correction; audio present/absent/ambiguous all correct; original bytes unchanged after view. |
| False/revoked/stale citation | >=30 hostile-output/lifecycle fixtures; zero accepted unknown ID, out-of-prompt quote, surrogate split, wrong scope/revision or late callback. Raw revision vs projected revision separate; selected summaries and richer metadata preserved. |
| Loading/cancel/offline/model failures | Real registered IPC+worker tests for startup/retirement/queue/retrieval/model/validation/cancel during relocation; no partial/late save, no producer overlap, no cross-owner cancellation. Missing model/network/provider spies, then actual cached-model offline packaged QA. |
| Exact counts/lists/partial coverage | Incomplete scan: zero model invocations, zero generated/live/cached answers; lower-level counts remain labeled observed lower bounds. Complete domain plus selection/budget omission: validated answer admitted with disclosure. >=12 exhaustive/partial fixtures, >1,000 source matches; 601 meetings !=1,202 passages; all complete predicates exact and all partial/top-k disclosures present; no free-form semantic census. |
| Conflicts/insufficiency/injection | 40 answerable +10 conflict +10 unanswerable +20 adversarial =80 cases, frozen gold originals. Human rates support/contradiction/unknown separately from membership. >=95% supported factual claims, zero materially contradicted commitments; all conflict cases cite both sides or explicitly abstain; all unanswerable abstain; zero scope/network/action escapes. |
| Second consumer | Two old linked meetings with absent attendee/topic words and head/middle/tail commitments; no other same-name person's meeting; []/1/256/257/dedup/unknown/trash/wrong-scope; event/correction change invalidates; validate every non-error result including empty/insufficient before display/cache; incomplete reconciliation withholds it; zero Home writes. Sampling omissions visible and no semantic completeness claim. |
| Persistence/compatibility | Restart/clear/save-failure/richer-field/history corruption/relocation tests; legacy array preserved, downgraded fallback safe, unknown versions block destructive overwrite; MCP existing tool schemas and Node18 stdio survive. |

Evaluate a cached selected model with artifact identity, actual prompt wire hashes, gold ranges, outputs, temperature and denominators retained using synthetic data only. Schema/quote tests cannot replace human support scoring. If thresholds fail, keep feature gate off; excerpt-only fallback is a separate reviewed behavior, not a passed answer-quality result.

Performance is a gate, not a speedup claim. Existing DEV506 historical 10k p95 ~1.43s and RSS ~1.66GiB are caveats, not a current baseline. Rerun identical 1k/10k fixtures on the same machine before/after, warmup then 20 mixed queries; report cold rebuild separately and main event-loop latency during synthetic capture. Required warmed retrieval p95 <=3s, main-loop p95 <=16ms, and no >20% p95/RSS regression from same-run baseline without review. Avoid duplicate full-library text copies; keep worker references, bounded ranking heap/window descriptors and hash during existing file read. 15s timeout does not excuse poor responsiveness. Record peak RSS honestly; do not add embedding dependencies to rescue a failed gate without a new design.

## Remaining gates

Full source tests, model evaluation, human semantic scoring, packaged QA and final stack review/merge remain. Keep the rollout gate off until qualified. No merge, publication, personal-data access or automatic model download is authorized.

## Implementation clarification: complete request digest (2026-10-18)

`CitedAnswerSnapshot.requestSha256?: string` is additive for TypeScript compatibility. Every new non-error snapshot, including no-history and insufficient-evidence without inference, populates it. Admission requires it; missing historical/untrusted values are never synthesized. The digest is SHA-256 of JSON.stringify of the normalized main request: fixed property order; exact untrimmed question/context/topic; normalized UTC filter instants; sorted, deduplicated explicit IDs; omitted subsets remain different from empty. Purpose, context template and consumerRevision participate. This protects callers that accidentally retain a revision while changing eventText. DEV509 consumes the snapshot unchanged and never constructs this digest. Main service constructor is `new MainCitedAskService({ sources, generate, validateModel, activity?, audio? })`; one shared main instance implements the unchanged CitedAskService interface and never persists.
