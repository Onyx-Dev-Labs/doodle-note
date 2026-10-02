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
  // Imports create the meeting's first part. Its metadata stores import time,
  // but its original transcript is file-relative and retains imported identity.
  // Do not seek that row in whichever later recording happens to be selected.
  const importedPart =
    segment.speakerId === 'imported-speaker'
      ? 0
      : parts.findIndex((part) => part.startEpochMs === 0)
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
  if (
    segment.absoluteStartMs !== undefined &&
    position.partIndex === 0 &&
    segment.speakerId !== 'imported-speaker'
  ) {
    return parts.reduce((sum, part) => sum + part.durationMs, 0) + segment.startMs
  }
  return (
    parts.slice(0, position.partIndex).reduce((sum, part) => sum + part.durationMs, 0) +
    position.offsetSec * 1000
  )
}
