import { randomUUID } from 'node:crypto'
import type { TextTranscriptSegment } from '@repo/meetings-store/types'

export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_TEXT_IMPORT_SEGMENTS = 10_000

/** UTF-8 plain paragraphs and standalone [Speaker N] headers. No timing is inferred. */
export function parseTextTranscript(bytes: Uint8Array): TextTranscriptSegment[] {
  if (bytes.byteLength > MAX_TEXT_IMPORT_BYTES)
    throw new Error('That transcript is too large (2 MB max).')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
  } catch {
    throw new Error('Save the transcript as UTF-8 plain text (.txt), then try again.')
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new Error(
      'That file contains binary or unsupported text. Choose a UTF-8 .txt transcript.'
    )
  }
  if (!text.trim()) throw new Error('That transcript is empty.')
  const segments: TextTranscriptSegment[] = []
  let speaker = 'Speaker'
  let speakerId = 'text-unknown'
  let lines: string[] = []
  const flush = (): void => {
    if (!lines.length) return
    const value = lines.join('\n')
    lines = []
    if (!value.trim()) return
    segments.push({
      id: randomUUID(),
      source: 'text',
      channel: 'text',
      speaker,
      speakerId,
      text: value
    })
    if (segments.length > MAX_TEXT_IMPORT_SEGMENTS)
      throw new Error('That transcript has too many sections (10,000 max).')
  }
  for (const line of text.split('\n')) {
    const marker = /^\s*\[Speaker (\d{1,9})\]\s*$/i.exec(line)
    if (marker) {
      flush()
      speaker = `Speaker ${marker[1]}`
      speakerId = `text-speaker-${marker[1]}`
    } else {
      lines.push(line)
    }
  }
  flush()
  if (!segments.length) throw new Error('That transcript has speaker headings but no text.')
  return segments
}
