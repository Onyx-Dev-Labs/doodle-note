/** Structural shape also accepts untimed imported text without inventing timings. */
interface SegmentIdentity {
  id: string
  channel: string
  source?: string
  absoluteStartMs?: number
  startMs?: number
}

/**
 * Merge a persisted checkpoint and the current capture snapshot. Older captures
 * restarted seg_N per part, so id alone is not unique. Preserve occurrences
 * within either source, and match only corresponding copies across sources.
 *
 * The returned IDs are stable view identities used by React and playback
 * highlighting. They are never persisted. Source IDs and records stay intact;
 * text/speaker/end-time corrections can replace a copy without adding a row.
 */
export function mergeTranscriptSegments<T extends SegmentIdentity>(saved: T[], live: T[]): T[] {
  const merged = new Map<string, T>()
  for (const segments of [saved, live]) {
    const occurrences = new Map<string, number>()
    for (const segment of segments) {
      const identity = JSON.stringify([
        segment.id,
        segment.source ?? 'audio',
        segment.channel,
        segment.absoluteStartMs ?? null,
        segment.startMs ?? null
      ])
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)
      const key = JSON.stringify([identity, occurrence])
      merged.set(key, { ...segment, id: key })
    }
  }
  return [...merged.values()]
}
