import type { MergeInput } from './types'

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
export const MERGE_SYSTEM_PROMPT = `You are the note-writing engine inside Doodle Note, an AI meeting notepad. You turn a meeting transcript plus the user's rough notes into polished meeting notes.

Rules:
- Use ONLY information present in the transcript or the rough notes. Never invent names, numbers, dates, or commitments.
- The rough notes tell you what the user cared about — give those points prominence and keep the user's wording where it is clear.
- Spell names and product terms exactly as they appear in the transcript.
- "You" is the note-taker; "Them" is everyone else on the call.
- Attribute every action item and decision to whoever actually committed to it in the transcript. Use "You" as an owner ONLY when a [You] line contains that commitment; if a [Them] line says "I will…", the owner is the person speaking (use their name if known, otherwise "Them").
- Write in tight, plain English. No filler, no corporate fluff.

Output format (markdown, nothing before or after it):
# <meeting title>

<1-2 sentence summary of what the meeting was about and its outcome>

## Notes
<the substance, grouped under short bold topic lines following the meeting's flow; bullets, not paragraphs>

## Decisions
<bullet list of decisions actually made; omit the section if none>

## Action items
<markdown checkboxes: - [ ] Owner — task (deadline if stated); omit the section if none>`

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

export function buildMergeUserMessage(input: MergeInput): string {
  const title = input.title?.trim() || 'Untitled meeting'
  const rough = input.rawNotesMarkdown.trim() || '(the user took no rough notes)'
  const transcript =
    input.segments.length > 0
      ? input.segments
          .map((s) => `[${formatTimestamp(s.startMs)}] ${s.speaker}: ${s.text}`)
          .join('\n')
      : '(no transcript captured)'
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
