import type { AudioPart } from '../../../shared/audio-api'
import type { MeetingTranscriptSegment } from '@repo/meetings-store/types'

/** Resolve imported file timing and recorded wall-clock timing to a saved part. */
export function transcriptAudioPosition(
  segment: MeetingTranscriptSegment,
  parts: AudioPart[],
  activePart = 0
): { partIndex: number; offsetSec: number } | null {
  if (segment.source === 'text' || parts.length === 0) return null
  if (typeof segment.absoluteStartMs === 'number') {
    let partIndex = 0
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]!.startEpochMs <= segment.absoluteStartMs) {
        partIndex = i
        break
      }
    }
    return {
      partIndex,
      offsetSec: Math.max(0, (segment.absoluteStartMs - parts[partIndex]!.startEpochMs) / 1000)
    }
  }
  // An imported part has no wall-clock anchor. It remains the source for its
  // relative rows even after Resume selects a later recording in the player.
  const importedPart = parts.findIndex((part) => part.startEpochMs === 0)
  return {
    partIndex: importedPart >= 0 ? importedPart : Math.min(activePart, parts.length - 1),
    offsetSec: Math.max(0, segment.startMs / 1000)
  }
}

/** Imported + resumed audio uses cumulative saved durations, not epoch minus zero. */
export function transcriptDisplayTime(
  segment: MeetingTranscriptSegment,
  parts: AudioPart[],
  hasImportedAudio: boolean
): number {
  if (segment.source === 'text') return 0
  if (!hasImportedAudio) return segment.absoluteStartMs ?? segment.startMs
  const position = transcriptAudioPosition(segment, parts)
  if (!position) return segment.startMs
  // While capture is running, its saved part may not have arrived yet.
  if (segment.absoluteStartMs !== undefined && parts[position.partIndex]!.startEpochMs === 0) {
    return parts.reduce((sum, part) => sum + part.durationMs, 0) + segment.startMs
  }
  return (
    parts.slice(0, position.partIndex).reduce((sum, part) => sum + part.durationMs, 0) +
    position.offsetSec * 1000
  )
}
