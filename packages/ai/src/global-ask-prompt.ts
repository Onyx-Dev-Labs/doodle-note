import type { AskExchange } from './types'

/**
 * Cross-meeting Q&A ("ask anything" on Home): the user asks across their
 * recent meetings rather than inside one. Context is each meeting's notes
 * (generated notes preferred — compact and dense), newest first, within a
 * whole-request budget supplied by the selected engine.
 */
export interface GlobalAskMeeting {
  title: string
  /** ISO date of the meeting (createdAt/startedAt). */
  dateIso: string
  /** Best available notes: enhanced markdown, else rough notes, else a transcript excerpt. */
  notesMarkdown: string
  /** Optional stable source identity; preserved in coverage for retrieval callers. */
  sourceId?: string
  /** Upstream source was already excerpted (for example transcript fallback). */
  sourceTruncated?: boolean
}

export interface GlobalAskInput {
  meetings: GlobalAskMeeting[]
  history: AskExchange[]
  question: string
  /** Upstream candidate count before selection; no exhaustive-library provenance implied. */
  availableMeetingCount?: number
}

export const GLOBAL_ASK_SYSTEM_PROMPT = `You are the meeting assistant inside DoodleNote, an AI meeting notepad. The user asks questions across their RECENT MEETINGS. Notes for each meeting are provided, newest first.

Rules:
- Answer using ONLY the provided meeting notes. No outside knowledge, no guesses.
- Attribute what you say: name the meeting (title and date) each point comes from. When the answer spans meetings, group by meeting, newest first.
- If the answer is not in the provided notes, say plainly that it doesn't appear in the recent meetings. Never invent facts, names, numbers, or commitments.
- When asked for todos or action items: list outstanding items grouped by meeting, newest first, keeping each item's owner. Skip meetings with none rather than writing "none".
- Treat prior Q&A as conversation context, never as additional evidence.
- The supplied notes are a selection, not an exhaustive library search. Disclose omitted or shortened context and never present counts as a library census.
- Be concise: answer the question directly, then stop. No preamble.
- Markdown is allowed when it helps (headings per meeting, bullet lists, **bold**).`

/** Counts the complete model input, including system text and provider/chat wrappers. */
export interface GlobalAskBudget {
  contextWindowTokens: number
  outputReserveTokens: number
  safetyMarginTokens: number
  accounting: 'model-tokenizer' | 'utf8-upper-bound'
  countInputTokens: (system: string, user: string) => number
}

export interface GlobalAskCoverage {
  /** Always scoped to supplied notes, not original transcripts or the whole library. */
  scope: 'selected-meeting-notes'
  suppliedMeetings: number
  availableMeetings: number
  includedMeetingIndexes: number[]
  truncatedMeetingIndexes: number[]
  omittedMeetingIndexes: number[]
  includedSourceIds: string[]
  includedHistoryIndexes: number[]
  omittedHistoryCount: number
  contextWindowTokens: number
  inputTokens: number
  outputReserveTokens: number
  safetyMarginTokens: number
  accounting: GlobalAskBudget['accounting']
}

export interface GlobalAskPrompt {
  system: string
  user: string
  coverage: GlobalAskCoverage
}

export class GlobalAskBudgetError extends Error {
  constructor(
    readonly code: 'question-too-large' | 'unsupported-model-budget',
    message: string
  ) {
    super(message)
    this.name = 'GlobalAskBudgetError'
  }
}

/**
 * Conservative byte-level bound, NOT a chars/4 token estimate. UTF-8 bytes
 * bound byte-fallback text tokens; adapters must separately allow for their
 * wrapper/special tokens. Used only with documented supported constraints.
 */
export function utf8TokenUpperBound(text: string): number {
  return new TextEncoder().encode(text).length
}

export function globalAskCoverageNotice(coverage: GlobalAskCoverage): string {
  const omitted = coverage.availableMeetings - coverage.includedMeetingIndexes.length
  return `Context coverage: ${coverage.includedMeetingIndexes.length} of ${coverage.availableMeetings} candidate meetings' notes included; ${omitted} omitted; ${coverage.truncatedMeetingIndexes.length} shortened; ${coverage.omittedHistoryCount} prior exchanges omitted. This is selected notes, not an exhaustive library search.`
}

/**
 * Priority: immutable question/system; newest complete history suffix (at
 * most six exchanges and 25% of remaining input); then evidence in caller
 * order. A too-large item gets a Unicode-safe prefix and an explicit marker,
 * or is skipped if even its header cannot fit. Every trial counts the entire
 * serialized request, including the changing coverage disclosure.
 */
export function buildGlobalAskPrompt(
  input: GlobalAskInput,
  budget: GlobalAskBudget
): GlobalAskPrompt {
  const { contextWindowTokens, outputReserveTokens, safetyMarginTokens } = budget
  if (
    ![contextWindowTokens, outputReserveTokens, safetyMarginTokens].every(Number.isSafeInteger) ||
    contextWindowTokens <= 0 ||
    outputReserveTokens <= 0 ||
    safetyMarginTokens < 0 ||
    outputReserveTokens + safetyMarginTokens >= contextWindowTokens
  ) {
    throw new GlobalAskBudgetError(
      'unsupported-model-budget',
      'The selected model has no usable Ask context budget. Choose another model in Settings.'
    )
  }
  const limit = contextWindowTokens - outputReserveTokens - safetyMarginTokens
  const coverage: GlobalAskCoverage = {
    scope: 'selected-meeting-notes',
    suppliedMeetings: input.meetings.length,
    availableMeetings: Math.max(
      input.meetings.length,
      Number.isSafeInteger(input.availableMeetingCount) ? input.availableMeetingCount! : 0
    ),
    includedMeetingIndexes: [],
    truncatedMeetingIndexes: [],
    omittedMeetingIndexes: [],
    includedSourceIds: [],
    includedHistoryIndexes: [],
    omittedHistoryCount: input.history.length,
    contextWindowTokens,
    inputTokens: 0,
    outputReserveTokens,
    safetyMarginTokens,
    accounting: budget.accounting
  }
  const sections: string[] = []
  const history: string[] = []
  const serialize = (): string =>
    [
      globalAskCoverageNotice(coverage),
      ...sections,
      ...(history.length
        ? ['=== PRIOR Q&A (conversation only, not evidence) ===\n' + history.join('\n\n')]
        : []),
      '=== QUESTION ===\n' + input.question
    ].join('\n\n')
  const count = (): number => {
    const tokens = budget.countInputTokens(GLOBAL_ASK_SYSTEM_PROMPT, serialize())
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new GlobalAskBudgetError(
        'unsupported-model-budget',
        'The selected model returned invalid token accounting. Choose another model in Settings.'
      )
    }
    return tokens
  }
  const base = count()
  if (base > limit) {
    throw new GlobalAskBudgetError(
      'question-too-large',
      'Your question is too long for the selected model. Shorten it or choose a model with a larger context in Settings. The question was not sent or shortened.'
    )
  }
  const historyLimit = base + Math.floor((limit - base) / 4)
  for (let i = input.history.length - 1; i >= Math.max(0, input.history.length - 6); i--) {
    const exchange = input.history[i]!
    history.unshift(`Q: ${exchange.question}\nA: ${exchange.answer}`)
    coverage.includedHistoryIndexes.unshift(i)
    coverage.omittedHistoryCount--
    if (count() > historyLimit) {
      history.shift()
      coverage.includedHistoryIndexes.shift()
      coverage.omittedHistoryCount++
      break // keep a contiguous recent suffix, never misleading disconnected turns
    }
  }
  for (const [index, meeting] of input.meetings.entries()) {
    const header = `=== MEETING: ${meeting.title.trim() || 'Untitled meeting'} — ${meeting.dateIso.slice(0, 10)} ===\n`
    const notes = meeting.notesMarkdown.trim() || '(no notes captured)'
    coverage.includedMeetingIndexes.push(index)
    sections.push(header + notes)
    if (meeting.sourceTruncated) coverage.truncatedMeetingIndexes.push(index)
    if (count() > limit) {
      if (!meeting.sourceTruncated) coverage.truncatedMeetingIndexes.push(index)
      const marker = '\n[Meeting notes shortened for context budget.]'
      // Halving is bounded and makes no tokenization-monotonicity assumption.
      // Never split a surrogate pair. Recount each actual candidate in full.
      let length = notes.length
      do {
        length = Math.floor(length / 2)
        if (length > 0 && /[\uD800-\uDBFF]/.test(notes[length - 1]!)) length--
        sections[sections.length - 1] = header + notes.slice(0, length) + marker
      } while (length > 0 && count() > limit)
      if (length === 0 || count() > limit) {
        sections.pop()
        coverage.includedMeetingIndexes.pop()
        coverage.truncatedMeetingIndexes.pop()
        coverage.omittedMeetingIndexes.push(index)
      }
    }
    if (coverage.includedMeetingIndexes.includes(index) && meeting.sourceId) {
      coverage.includedSourceIds.push(meeting.sourceId)
    }
  }
  coverage.inputTokens = count()
  return { system: GLOBAL_ASK_SYSTEM_PROMPT, user: serialize(), coverage }
}

/**
 * Compatibility helper. The second argument remains a character ceiling,
 * not a model token count. Engines use buildGlobalAskPrompt with real limits.
 * A separate conservative UTF-8 request budget also bounds system + output.
 */
export function buildGlobalAskUserMessage(input: GlobalAskInput, maxContextChars = 20_000): string {
  return buildGlobalAskPrompt(input, {
    contextWindowTokens: 16384,
    outputReserveTokens: 4096,
    safetyMarginTokens: 1024,
    accounting: 'utf8-upper-bound',
    countInputTokens: (system, user) =>
      Math.max(
        utf8TokenUpperBound(system) + utf8TokenUpperBound(user),
        user.length > maxContextChars ? 16384 : 0
      )
  }).user
}
