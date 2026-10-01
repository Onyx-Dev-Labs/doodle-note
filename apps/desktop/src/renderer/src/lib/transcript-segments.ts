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
 * Map keys are stable view identities used by React and playback highlighting.
 * Source IDs and records stay intact; text/speaker/end-time corrections can
 * replace a copy without adding a row.
 */
function transcriptEntries<T extends SegmentIdentity>(saved: T[], live: T[]): Map<string, T> {
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
      merged.set(key, segment)
    }
  }
  return merged
}

/** Promote a completed live snapshot without copying checkpoint overlap or changing source IDs. */
export function reconcileTranscriptSegments<T extends SegmentIdentity>(saved: T[], live: T[]): T[] {
  return [...transcriptEntries(saved, live).values()]
}

/** Assign view-only identities after raw snapshot/checkpoint reconciliation. */
export function mergeTranscriptSegments<T extends SegmentIdentity>(saved: T[], live: T[]): T[] {
  return [...transcriptEntries(saved, live)].map(([key, segment]) => ({ ...segment, id: key }))
}
