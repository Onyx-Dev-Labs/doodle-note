import type { AskExchange } from './types'

/**
 * Cross-meeting Q&A ("ask anything" on Home): the user asks across their
 * recent meetings rather than inside one. Context is each meeting's notes
 * (generated notes preferred — compact and dense), newest first, within a
 * character budget suited to the local model's context window.
 */
export interface GlobalAskMeeting {
  title: string
  /** ISO date of the meeting (createdAt/startedAt). */
  dateIso: string
  /** Best available notes: enhanced markdown, else rough notes, else a transcript excerpt. */
  notesMarkdown: string
}

export interface GlobalAskInput {
  meetings: GlobalAskMeeting[]
  history: AskExchange[]
  question: string
}

export const GLOBAL_ASK_SYSTEM_PROMPT = `You are the meeting assistant inside DoodleNote, an AI meeting notepad. The user asks questions across their RECENT MEETINGS. Notes for each meeting are provided, newest first.

Rules:
- Answer using ONLY the provided meeting notes. No outside knowledge, no guesses.
- Attribute what you say: name the meeting (title and date) each point comes from. When the answer spans meetings, group by meeting, newest first.
- If the answer is not in the provided notes, say plainly that it doesn't appear in the recent meetings. Never invent facts, names, numbers, or commitments.
- When asked for todos or action items: list outstanding items grouped by meeting, newest first, keeping each item's owner. Skip meetings with none rather than writing "none".
- Be concise: answer the question directly, then stop. No preamble.
- Markdown is allowed when it helps (headings per meeting, bullet lists, **bold**).`

const MAX_GLOBAL_HISTORY = 6

export function buildGlobalAskUserMessage(
  input: GlobalAskInput,
  maxContextChars = 20_000
): string {
  const sections: string[] = []
  let used = 0
  let omitted = 0
  for (const meeting of input.meetings) {
    const title = meeting.title.trim() || 'Untitled meeting'
    const date = meeting.dateIso.slice(0, 10)
    const notes = meeting.notesMarkdown.trim() || '(no notes captured)'
    const section = `=== MEETING: ${title} — ${date} ===\n${notes}`
    if (used + section.length > maxContextChars && sections.length > 0) {
      omitted += 1
      continue
    }
    sections.push(section)
    used += section.length
  }
  if (omitted > 0) {
    sections.push(`(${omitted} older meeting${omitted === 1 ? '' : 's'} omitted for length)`)
  }

  const history = input.history.slice(-MAX_GLOBAL_HISTORY)
  const historyBlock =
    history.length > 0
      ? `\n\n=== PRIOR Q&A (this conversation) ===\n${history
          .map((h) => `Q: ${h.question}\nA: ${h.answer}`)
          .join('\n\n')}`
      : ''

  return `${sections.join('\n\n')}${historyBlock}

=== QUESTION ===
${input.question}`
}
