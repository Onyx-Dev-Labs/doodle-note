import { createHash } from 'node:crypto'
import type { MeetingRecord } from '../shared/meetings-api'

const MEDIA_REF = /doodle-media:\/\/([a-z0-9.-]+)/g

/** Attachment names referenced in the meeting's markdown. */
export function mediaRefs(record: MeetingRecord): string[] {
  const text = `${record.rawNotesMarkdown}\n${record.enhancedMarkdown ?? ''}`
  return [...new Set([...text.matchAll(MEDIA_REF)].map((m) => m[1]!))]
}

/** Local doodle-media:// refs → public blob URLs (only those uploaded). */
export function rewriteMedia(markdown: string, mediaUrls: Record<string, string>): string {
  return markdown.replace(MEDIA_REF, (whole, name: string) => mediaUrls[name] ?? whole)
}

/** Segments that actually ship on push — echo-flagged bleed is local-only. */
export function syncableSegments(record: MeetingRecord): MeetingRecord['segments'] {
  return record.segments.filter((s) => !s.echo)
}

/**
 * Stable hash of everything the push carries — change detection. Echo-flagged
 * segments are excluded (they never leave the device), and the media rewrite
 * is included so a late-arriving upload URL triggers a re-push.
 */
export function contentHash(record: MeetingRecord, mediaUrls: Record<string, string>): string {
  const projection = {
    ...(record.kind === 'note' ? { kind: 'note' as const } : {}),
    title: record.title,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    endedAt: record.endedAt ?? null,
    calendarEventId: record.calendarEventId ?? null,
    folderId: record.folderId ?? null,
    rawNotesMarkdown: rewriteMedia(record.rawNotesMarkdown, mediaUrls),
    enhancedMarkdown: record.enhancedMarkdown
      ? rewriteMedia(record.enhancedMarkdown, mediaUrls)
      : null,
    segments: syncableSegments(record).map((s) => [
      s.channel,
      s.speaker,
      s.text,
      s.startMs,
      s.endMs,
      // In the hash so meetings that gained anchors locally re-push once.
      s.absoluteStartMs ?? null
    ])
  }
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex')
}
