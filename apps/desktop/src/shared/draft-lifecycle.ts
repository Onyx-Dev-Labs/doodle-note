import type { TranscriptSegment } from '@repo/meetings-store/types'

export type DraftKind = 'meeting' | 'note'

export interface DraftContent {
  kind?: DraftKind
  title: string
  rawNotesMarkdown: string
  enhancedMarkdown?: string | null
  segments?: ReadonlyArray<Pick<TranscriptSegment, 'text'>>
  partialTranscript?: ReadonlyArray<string | undefined>
}

const GENERIC_TITLES = new Set([
  '',
  'new',
  'new meeting',
  'new note',
  'untitled',
  'untitled meeting',
  'untitled note'
])

const GENERIC_HEADINGS = new Set([
  'action items',
  'key points',
  'meeting notes',
  'notes',
  'overview',
  'summary',
  'transcript'
])

/** Titles the app historically used when the user had not supplied one. */
export function isGenericDraftTitle(title: string): boolean {
  return GENERIC_TITLES.has(title.trim().toLowerCase())
}

/** A new draft only needs the save/discard decision when it has no real content. */
export function hasMeaningfulDraftContent(content: DraftContent): boolean {
  if (!isGenericDraftTitle(content.title)) return true
  if (hasMeaningfulMarkdown(content.rawNotesMarkdown)) return true
  if (hasMeaningfulMarkdown(content.enhancedMarkdown ?? '')) return true
  if (content.segments?.some((segment) => cleanCandidate(segment.text).length > 0)) return true
  return content.partialTranscript?.some((text) => cleanCandidate(text ?? '').length > 0) ?? false
}

export function newDraftNeedsExitDecision(isNewDraft: boolean, content: DraftContent): boolean {
  return isNewDraft && !hasMeaningfulDraftContent(content)
}

function cleanCandidate(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>+\s*/, '')
    .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*(?:title|meeting)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s:;,.!?\-–—]+$/, '')
}

function firstUsefulMarkdownLine(markdown: string, preferHeading: boolean): string | null {
  const lines = markdown.split(/\r?\n/)
  if (preferHeading) {
    for (const line of lines) {
      if (!/^\s{0,3}#\s+\S/.test(line)) continue
      const cleaned = cleanCandidate(line)
      if (
        cleaned &&
        !GENERIC_HEADINGS.has(cleaned.toLowerCase()) &&
        !isGenericDraftTitle(cleaned)
      ) {
        return cleaned
      }
    }
  }
  for (const line of lines) {
    if (!line.trim() || /^\s*(?:---+|```)/.test(line)) continue
    const cleaned = cleanCandidate(line)
    if (cleaned && !GENERIC_HEADINGS.has(cleaned.toLowerCase()) && !isGenericDraftTitle(cleaned)) {
      return cleaned
    }
  }
  return null
}

function hasMeaningfulMarkdown(markdown: string): boolean {
  return firstUsefulMarkdownLine(markdown, true) !== null || /!\[[^\]]*\]\([^)]+\)/.test(markdown)
}

function concise(value: string, maxLength = 72): string {
  const cleaned = cleanCandidate(value)
  if (cleaned.length <= maxLength) return cleaned
  const slice = cleaned.slice(0, maxLength + 1)
  const wordBoundary = slice.lastIndexOf(' ')
  return `${slice.slice(0, wordBoundary >= 36 ? wordBoundary : maxLength).trim()}…`
}

/**
 * Derive a stable title without overwriting one the user/calendar supplied.
 * Generated notes win because their first H1 is already the model's concise
 * description; rough notes and transcript are deterministic offline fallbacks.
 */
export function deriveDraftTitle(content: DraftContent): string | null {
  const current = content.title.trim()
  if (!isGenericDraftTitle(current)) return current

  const enhanced = content.enhancedMarkdown
    ? firstUsefulMarkdownLine(content.enhancedMarkdown, true)
    : null
  if (enhanced) return concise(enhanced)

  const rough = firstUsefulMarkdownLine(content.rawNotesMarkdown, false)
  if (rough) return concise(rough)

  const attachmentTitle = content.kind === 'note' ? 'Note with attachment' : 'Meeting attachment'
  if (/!\[[^\]]*\]\([^)]+\)/.test(content.rawNotesMarkdown)) return attachmentTitle
  if (content.enhancedMarkdown && /!\[[^\]]*\]\([^)]+\)/.test(content.enhancedMarkdown)) {
    return attachmentTitle
  }

  const transcript = [
    ...(content.segments?.map((segment) => segment.text) ?? []),
    ...(content.partialTranscript ?? []).filter((text): text is string => Boolean(text?.trim()))
  ]
    .map(cleanCandidate)
    .filter(Boolean)
    .join(' ')
  if (transcript) return concise(transcript)

  return null
}

/** Explicit label for the rare case where the user chooses to keep an empty draft. */
export function emptyDraftTitle(kind: DraftKind, createdAt = new Date()): string {
  const label = kind === 'note' ? 'Empty note' : 'Empty meeting'
  const when = createdAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `${label} — ${when}`
}
