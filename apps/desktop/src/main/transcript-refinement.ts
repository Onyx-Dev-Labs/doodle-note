import { defaultSpeakerId, defaultSpeakerLabel } from '@repo/meetings-store'
import type { EngineChannel, TranscriptSegment } from '../shared/engine-events'

export interface RefinedChannelText {
  channel: EngineChannel
  text: string
  audioSeconds?: number
}

interface WordSlot {
  text: string
  normalized: string
  segmentIndex: number
}

function words(text: string): string[] {
  return text.trim().match(/\S+/g) ?? []
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('en-US').replace(/[^a-z0-9']/g, '')
}

/**
 * Align final-model words to the live transcript's segment boundaries.
 * Whisper tiny.en does not expose word timestamps through sherpa-onnx, so the
 * reliable live timings remain authoritative while its corrected words replace
 * provisional text. Existing ids, speakers, echo flags and seek anchors survive.
 */
export function reconcileChannelSegments(
  provisional: TranscriptSegment[],
  refined: RefinedChannelText
): TranscriptSegment[] {
  const finalWords = words(refined.text)
  if (finalWords.length === 0) return provisional

  if (provisional.length === 0) {
    const endMs = Math.max(0, Math.round((refined.audioSeconds ?? 0) * 1000))
    return [
      {
        id: `refined_${refined.channel}_1`,
        channel: refined.channel,
        speaker: defaultSpeakerLabel(refined.channel),
        speakerId: defaultSpeakerId(refined.channel),
        text: finalWords.join(' '),
        startMs: 0,
        endMs,
        confidence: 0.9
      }
    ]
  }

  const baseline: WordSlot[] = provisional.flatMap((segment, segmentIndex) =>
    words(segment.text).map((text) => ({ text, normalized: normalize(text), segmentIndex }))
  )
  if (baseline.length === 0) return provisional

  const candidate = finalWords.map((text) => ({ text, normalized: normalize(text) }))
  const rows = baseline.length + 1
  const cols = candidate.length + 1
  const cost = Array.from({ length: rows }, () => new Uint32Array(cols))
  for (let i = 0; i < rows; i++) cost[i]![0] = i
  for (let j = 0; j < cols; j++) cost[0]![j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const substitution =
        cost[i - 1]![j - 1]! +
        (baseline[i - 1]!.normalized === candidate[j - 1]!.normalized ? 0 : 1)
      cost[i]![j] = Math.min(cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1, substitution)
    }
  }

  const assignments = new Array<number | undefined>(candidate.length)
  let i = baseline.length
  let j = candidate.length
  while (i > 0 || j > 0) {
    const diagonal = i > 0 && j > 0 ? cost[i - 1]![j - 1]! : Number.POSITIVE_INFINITY
    const substitution =
      i > 0 && j > 0 && baseline[i - 1]!.normalized !== candidate[j - 1]!.normalized ? 1 : 0
    if (i > 0 && j > 0 && cost[i]![j] === diagonal + substitution) {
      assignments[j - 1] = baseline[i - 1]!.segmentIndex
      i--
      j--
    } else if (j > 0 && cost[i]![j] === cost[i]![j - 1]! + 1) {
      j--
    } else {
      i--
    }
  }

  // Inserted words inherit the nearest aligned segment, preferring the word
  // immediately before them so punctuation and short additions stay together.
  let previous: number | undefined
  for (let k = 0; k < assignments.length; k++) {
    if (assignments[k] !== undefined) previous = assignments[k]
    else if (previous !== undefined) assignments[k] = previous
  }
  let next: number | undefined
  for (let k = assignments.length - 1; k >= 0; k--) {
    if (assignments[k] !== undefined) next = assignments[k]
    else if (next !== undefined) assignments[k] = next
  }
  for (let k = 0; k < assignments.length; k++) {
    assignments[k] ??= Math.min(
      provisional.length - 1,
      Math.floor((k * provisional.length) / assignments.length)
    )
  }

  const grouped = provisional.map(() => [] as string[])
  for (let k = 0; k < candidate.length; k++) {
    grouped[assignments[k]!]!.push(candidate[k]!.text)
  }

  return provisional.flatMap((segment, segmentIndex) => {
    const text = grouped[segmentIndex]!.join(' ').trim()
    return text.length > 0 ? [{ ...segment, text }] : []
  })
}

export function reconcileRefinedTranscript(
  provisional: TranscriptSegment[],
  refined: RefinedChannelText[]
): TranscriptSegment[] {
  const replacements = new Map<string, TranscriptSegment>()
  const removed = new Set<string>()
  const additions: TranscriptSegment[] = []

  for (const result of refined) {
    const source = provisional.filter((segment) => segment.channel === result.channel)
    const next = reconcileChannelSegments(source, result)
    for (const segment of source) removed.add(segment.id)
    for (const segment of next) {
      if (source.some((existing) => existing.id === segment.id))
        replacements.set(segment.id, segment)
      else additions.push(segment)
    }
  }

  return provisional
    .filter((segment) => !removed.has(segment.id) || replacements.has(segment.id))
    .map((segment) => replacements.get(segment.id) ?? segment)
    .concat(additions)
    .sort(
      (a, b) =>
        (a.absoluteStartMs ?? a.startMs) - (b.absoluteStartMs ?? b.startMs) ||
        a.channel.localeCompare(b.channel)
    )
}
