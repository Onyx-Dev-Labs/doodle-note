import { formatTranscript } from './prompt'
import type { AskInput } from './types'

/**
 * The "ask anything" prompt — chat with one meeting.
 *
 * Design intents:
 * - Grounding is absolute: the model may use ONLY the meeting context handed
 *   to it (transcript, rough notes, generated notes, prior Q&A). Small local
 *   models embellish readily, so "it didn't come up" is spelled out as the
 *   required response for anything the meeting doesn't cover.
 * - Answers land in a chat bubble, so they should be short and direct;
 *   markdown is fine but preamble is not.
 * - Email drafting is the one "produce an artifact" case (Granola parity):
 *   the output must be ready to send, still built only from meeting facts.
 */
export const ASK_SYSTEM_PROMPT = `You are the meeting assistant inside Doodle Note, an AI meeting notepad. The user asks questions about ONE specific meeting; its full context (transcript, the user's rough notes, generated notes, prior Q&A) is provided with the question.

Rules:
- Answer using ONLY the provided meeting context. No outside knowledge, no guesses.
- If the answer is not in the meeting, say plainly that it didn't come up in this meeting. Never invent facts, names, numbers, or commitments.
- "You" is the note-taker (the person asking you); "Them" is the other participant(s) on the call.
- Be concise: answer the question directly, then stop. No preamble like "Based on the meeting…".
- Markdown is allowed when it helps (bullet lists, **bold**); plain sentences otherwise.
- When asked to draft an email (e.g. a follow-up), produce a ready-to-send email grounded in the meeting's decisions and action items: a Subject line, a brief recap, decisions made, and action items with owners. Use only facts from the meeting and add no placeholders beyond the sender's own sign-off.`

/** Prior exchanges included in the prompt — older ones are dropped. */
const MAX_ASK_HISTORY = 6

export function buildAskUserMessage(input: AskInput): string {
  const title = input.title?.trim() || 'Untitled meeting'
  const rough = input.rawNotesMarkdown.trim() || '(the user took no rough notes)'
  const transcript =
    input.segments.length > 0 ? formatTranscript(input.segments) : '(no transcript captured)'
  const generated = input.enhancedMarkdown?.trim()
  const history = input.history.slice(-MAX_ASK_HISTORY)

  const sections = [
    `Meeting: ${title}`,
    `=== TRANSCRIPT ===\n${transcript}`,
    `=== USER'S ROUGH NOTES ===\n${rough}`
  ]
  if (generated) {
    sections.push(`=== GENERATED NOTES ===\n${generated}`)
  }
  if (history.length > 0) {
    const exchanges = history.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n')
    sections.push(`=== PRIOR Q&A (this conversation) ===\n${exchanges}`)
  }
  sections.push(
    `=== QUESTION ===\n${input.question.trim()}\n\nAnswer using only the meeting context above.`
  )
  return sections.join('\n\n')
}
