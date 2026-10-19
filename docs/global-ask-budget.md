# Global Ask request budget (DEV-505)

DEV-507 adds a separate production-gated [cited local Ask path](cited-ask.md).
It uses original evidence and no chat history, with native exact-wire range
inclusion and current-request/source validation. The legacy Global Ask behavior
documented below remains compatible; its selected-note coverage is not upgraded
into an original-evidence or complete-library claim.

`buildGlobalAskPrompt(input, budget)` returns `{ system, user, coverage }`. Callers
must send these exact strings and enforce `budget.outputReserveTokens` as their
maximum generated tokens. The complete input count + output reserve + safety
margin must not exceed the adapter's context window. This is request assembly,
not retrieval, original-source verification, or a library census.

## Additive contract for DEV-506 / DEV-507

- `GlobalAskInput` retains `meetings`, `history`, and `question`. Meetings are in
  caller priority order; history is oldest first. Optional `availableMeetingCount`
  describes the upstream candidate pool, **not verified full eligible-library
  coverage**. Missing/invalid counts fall back to the supplied count.
- `GlobalAskMeeting` retains title/date/notes; optional `sourceId` passes a stable
  caller identity through to coverage. Optional `sourceTruncated` declares an
  upstream excerpt. Neither establishes source revision or quote validity.
- `GlobalAskBudget` contains `contextWindowTokens`, `outputReserveTokens`,
  `safetyMarginTokens`, `accounting`, and a pure deterministic
  `countInputTokens(system, user)` callback. The callback must count/bound the
  complete serialized model input, or document wrapper allowance in the margin.
- Coverage includes supplied and upstream candidate counts, included/omitted/
  shortened original meeting indexes, included source IDs, included original
  history indexes, omitted history count, and budget accounting totals. Its scope
  is always `selected-meeting-notes`; it makes no exhaustive-library claim.
- `AskAnswer`, desktop `GlobalAskResult` and persisted `GlobalChatEntry` add optional
  `coverage`. The desktop service appends a deterministic disclosure to the answer
  and streams/persists it. Existing entries without coverage still load.
- `GlobalAskBudgetError.code` is `question-too-large` or
  `unsupported-model-budget`; the desktop returns it as additive `code` alongside
  its existing actionable `error`. Failed requests do not save an exchange.
- `buildGlobalAskUserMessage(input, maxContextChars?)` remains a compatibility
  helper. It now bounds the full message with a separate conservative UTF-8
  budget and respects the character ceiling. Engines use the new model contract.

## Deterministic reduction

Reserve system, exact question, coverage text, chat/provider wrappers, output,
and safety allowance first. If the question cannot fit, reject without editing
it or sending it for generation. Retain a contiguous newest suffix of at most
six complete prior exchanges, capped at 25% of the remaining input allowance.
Then consider evidence in caller order. If a full item cannot fit, halve its
notes prefix until it fits (never splitting a surrogate pair), with an explicit
shortening marker; omit an item whose header/marker cannot fit. Continue trying
later candidates. Halving does not rely on token-count monotonicity. Every trial
recounts the complete request including the changing coverage disclosure.
Ordinary short evidence and history are retained. Prior answers are explicitly
conversation context, not evidence. No source files are modified.

The desktop retains its existing newest-30 selection and note preference
(generated notes, rough notes, then a transcript excerpt). It reports the candidate
pool before that cap and declares transcript excerpts as shortened. This PR does
not replace selection with full-library retrieval.

## Adapter constraints and accounting

- **node-llama-cpp 3.20.0:** Use the actual allocated `context.contextSize` (not just
  the requested default 16,384), the session's resolved chat wrapper and the
  loaded model's tokenizer. Serialize the initial system history, user message,
  and empty model response exactly as `LlamaChatSession.promptWithMeta` does.
  Reserve/enforce the existing writing limit of 4,096 output tokens, plus 256
  safety tokens. Budget assembly remains inside the writing deadline; context
  disposal runs on success, failure or cancellation. GPU-to-CPU retry retains
  the same accounting. Summary generation/cancellation is unchanged.
- **Hosted default models:** Explicit verified IDs only: `claude-sonnet-5`
  1,000,000; `gpt-5` 400,000; `grok-4.6` 500,000; `gemini-3.8-flash` 1,048,576.
  Treat Gemini's input limit as a stricter shared input/output ceiling. Reserve
  and pass 4,096 output tokens to the SDK. Count one token per UTF-8 byte of the
  system/user text and reserve 1,024 additional wrapper/special tokens. This is a
  deliberately conservative **upper bound, not a measured token count or a
  character-equals-token assumption**. Unknown/custom model IDs fail before
  transmission with instructions to select the provider default or a local model;
  they never inherit a guessed family window or trigger provider fallback.
- **Ollama:** The OpenAI compatibility endpoint cannot set `num_ctx`. Read local
  `/api/show` metadata and require an explicit Modelfile runtime `num_ctx`, capped
  by the model's trained window. An unset/unknown window fails before content
  transmission. Only local Llama models using the audited `llama3-instruct`
  template are supported by this fallback; arbitrary templates can repeat input
  and cannot be bounded by their source length. Unknown/custom templates and
  cloud-backed metadata fail with an actionable error. Embedded `/api/show.messages`
  must be absent or an empty array: nonempty or malformed values fail before
  generation, because Ollama prepends these entries even to a request with an
  explicit system message. Separately, model `system` text is not added when the
  request starts with our explicit system message; wire regressions verify this
  invariant with empty/absent messages and a large model system prompt.
  Count UTF-8 input bytes, reserve twice the audited template's UTF-8 length plus
  1,024 wrapper tokens,
  and reserve/enforce `min(4096, floor(window / 4))` output tokens. Metadata reads
  contain only the model ID, use the existing localhost server and a 15s timeout.
  No model downloads, settings changes or hosted fallback occur.

Limits verified October 17, 2026 against primary documentation:
[local chat wrappers](https://node-llama-cpp.withcat.ai/guide/chat-wrapper),
[Sonnet 5](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5),
[GPT-5](https://developers.openai.com/api/docs/models/gpt-5),
[Grok 4.6](https://docs.x.ai/developers/models/grok-4.6),
[Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[Ollama context configuration](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size),
[Ollama Llama template](https://github.com/ollama/ollama/blob/main/template/llama3-instruct.gotmpl),
[Ollama chat assembly](https://github.com/ollama/ollama/blob/main/server/routes.go)
(`chatMessagesForRequest`).

## Verification and native gate

Synthetic prompt, adapter-wire and real-service persistence tests cover oversized
first notes, six large exchanges, Unicode, huge headings, exact boundaries,
question rejection, source/excerpt metadata, policy denial, unknown models,
output caps, local context disposal, retry, and Ollama embedded-message rejection
(including a synthetic 500,000-byte hidden system message). Native runtime is
replaced in adapter/service unit tests: these tests do not qualify installed
macOS/Windows.

Development launch (separate profile, no personal meetings):

```sh
DOODLE_USER_DATA=/tmp/doodlenote-dev505-qa pnpm --filter desktop dev
```

Use only synthetic meetings in that profile. This is development smoke, not a
packaged build qualification. In an isolated macOS desktop profile with a cached
supported local model, exercise
short Ask, a 25k note, six large exchanges, a Unicode question, and a non-fitting
question. Verify visible coverage, retained original notes, explicit error and
successful retry; repeat with networking disabled. Verify existing summary Cancel
still stops native work and releases the service. Record packaged build SHA and
OS. Windows native QA follows the macOS gate; signing and release are separate.

Rollback requires reverting code only. Optional persisted coverage is additive;
no migration or deletion of original meetings/history is required.
