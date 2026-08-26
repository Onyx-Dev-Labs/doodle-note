import type { MeetingRecord } from '@repo/meetings-store'
import { escapeHtml, markdownToHtml } from '../shared/markdown-html'

/** Pure export builders — split from export-service so node:test can run
 *  them without importing Electron. */

function formatClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** One portable markdown document: header, notes, timestamped transcript. */
export function buildExportMarkdown(record: MeetingRecord): string {
  const title = record.title.trim() || 'Untitled meeting'
  const when = record.startedAt ?? record.createdAt
  const date = new Date(when).toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'short'
  })
  const notes = (record.enhancedMarkdown ?? record.rawNotesMarkdown).trim()
  const segments = record.segments.filter((s) => !s.echo)

  const parts: string[] = [`# ${title}`, '', `*${date} · exported from DoodleNote*`, '']
  if (notes) {
    parts.push(notes, '')
  }
  if (segments.length > 0) {
    const base = segments[0]!.startMs
    parts.push('## Transcript', '')
    for (const s of segments) {
      parts.push(`**[${formatClock(s.startMs - base)}] ${s.speaker}:** ${s.text}`)
      parts.push('')
    }
  }
  return parts.join('\n').trimEnd() + '\n'
}

/** The PDF page: brand-adjacent print styling around the rendered markdown. */
export function buildExportHtml(record: MeetingRecord, markdown: string): string {
  const title = escapeHtml(record.title.trim() || 'Untitled meeting')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #26281f;
           max-width: 660px; margin: 0 auto; padding: 24px 8px; font-size: 12.5px; line-height: 1.55; }
    h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; margin: 0 0 4px; }
    h2 { font-family: Georgia, serif; font-size: 17px; margin: 22px 0 8px;
         border-bottom: 1px solid #ddd8c9; padding-bottom: 4px; }
    h3 { font-size: 14px; margin: 16px 0 6px; }
    em { color: #6f7362; }
    ul, ol { padding-left: 22px; } li { margin: 3px 0; }
    strong { color: #26281f; }
    blockquote { border-left: 3px solid #7c9769; margin: 8px 0; padding: 2px 12px; color: #555a48; }
    pre { background: #f4f2e9; padding: 10px; border-radius: 6px; overflow-x: hidden; white-space: pre-wrap; }
    img { max-width: 100%; }
    a { color: #55703f; }
  </style></head><body>${markdownToHtml(markdown)}</body></html>`
}
