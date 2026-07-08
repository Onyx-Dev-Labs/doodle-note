import { templateById } from './templates'
import type { MergeInput, MergeSegment } from './types'

/**
 * The note-merge prompt — Doodle Note's core product surface.
 *
 * Design intents:
 * - The user's rough notes signal what THEY cared about; the transcript is
 *   the ground truth for facts. Notes shape the emphasis, transcript fills
 *   the substance.
 * - Never invent facts. Small local models are prone to embellishment, so
 *   the constraints are stated bluntly and the output shape is rigid.
 * - Markdown out, no preamble, so the result can be dropped straight into
 *   the editor.
 */
const MERGE_RULES = `You are the note-writing engine inside Doodle Note, an AI meeting notepad. You turn a meeting transcript plus the user's rough notes into polished meeting notes.

Rules:
- Use ONLY information present in the transcript or the rough notes. Never invent names, numbers, dates, or commitments.
- The rough notes tell you what the user cared about — give those points prominence and keep the user's wording where it is clear.
- Spell names and product terms exactly as they appear in the transcript.
- "You" is the note-taker; "Them" is everyone else on the call.
- Attribute every action item and decision to whoever actually committed to it in the transcript. Use "You" as an owner ONLY when a [You] line contains that commitment; if a [Them] line says "I will…", the owner is the person speaking (use their name if known, otherwise "Them").
- Preserve concrete details exactly as spoken: people and company names, product and tool names, dollar amounts, quantities, dates, deadlines, URLs. When the transcript names a specific thing, the notes name it too — a generic line that could describe any meeting ("discussed improving security") is a failure when the transcript has specifics ("move the repos to the Acme GitHub org and add SSO").
- Detail scales with the transcript. A long, substantive meeting deserves thorough notes that follow each discussion; a short or garbled transcript deserves short notes. Never pad thin material into something that sounds complete.
- Write in tight, plain English. No filler, no corporate fluff.
- A section heading with nothing real to put under it is omitted entirely.

`

/** Shared rules + the selected template's output format. */
export function buildMergeSystemPrompt(templateId?: string): string {
  return MERGE_RULES + templateById(templateId).outputFormat
}

/** The default (general-template) prompt — kept for compatibility. */
export const MERGE_SYSTEM_PROMPT = buildMergeSystemPrompt('general')

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

/** `[m:ss] Speaker: text`, one line per segment — shared by merge + ask prompts. */
export function formatTranscript(segments: MergeSegment[]): string {
  return segments.map((s) => `[${formatTimestamp(s.startMs)}] ${s.speaker}: ${s.text}`).join('\n')
}

/**
 * Transcript budget for the merge prompt. Sized to the local engine's
 * context window (16K tokens ≈ 60K chars, leaving room for rules + output);
 * cloud models never come close. Overflow keeps the head and tail — the
 * setup and the conclusions — and says so, rather than silently truncating
 * (a truncated-but-unmarked transcript invites the model to fill gaps).
 */
const MAX_TRANSCRIPT_CHARS = 48_000

export function buildMergeUserMessage(input: MergeInput): string {
  const title = input.title?.trim() || 'Untitled meeting'
  const rough = input.rawNotesMarkdown.trim() || '(the user took no rough notes)'
  let transcript =
    input.segments.length > 0 ? formatTranscript(input.segments) : '(no transcript captured)'
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    const half = MAX_TRANSCRIPT_CHARS / 2
    transcript =
      transcript.slice(0, half) +
      '\n[… middle of a long transcript omitted — do not guess at its contents …]\n' +
      transcript.slice(-half)
  }
  const duration =
    input.durationMs !== undefined
      ? `\nDuration: ${Math.round(input.durationMs / 60000)} minutes`
      : ''

  return `Meeting: ${title}${duration}

=== USER'S ROUGH NOTES ===
${rough}

=== TRANSCRIPT ===
${transcript}

Write the polished meeting notes now.`
}
