import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EngineChannel, EngineTokenTiming, TranscriptSegment } from '../shared/engine-events'
import { SegmentAssembler } from './segmenter'
import { EchoOrderGate } from './windows-asr-echo-gate'

const words = (text: string, start: number): EngineTokenTiming[] =>
  text.split(' ').map((word, index) => ({
    token: ` ${word}`,
    startSec: start + index * 0.4,
    endSec: start + index * 0.4 + 0.3,
    confidence: 0.9
  }))

/**
 * The far side talks for 20 s in one utterance; the mic picks it up through
 * the speakers in two shorter utterances. The mic copies are committed (and
 * the first closed) before the system utterance is decoded.
 */
function scenario(
  route: (event: Record<string, unknown>) => void,
  settle: (sec: number) => void
): void {
  route({ event: 'channel_start', channel: 'mic', epochMs: 1000 })
  route({ event: 'channel_start', channel: 'system', epochMs: 1000 })
  route({ event: 'timings', channel: 'mic', tokens: words('we should ship the beta on friday', 1) })
  route({ event: 'timings', channel: 'mic', tokens: words('and review the budget next week', 8) })
  settle(25)
  route({
    event: 'timings',
    channel: 'system',
    tokens: [
      ...words('we should ship the beta on friday', 1),
      ...words('and review the budget next week', 8)
    ]
  })
}

function assemble(gated: boolean): TranscriptSegment[] {
  const assembler = new SegmentAssembler()
  const segments: TranscriptSegment[] = []
  const deliver = (event: Record<string, unknown>): void => {
    if (event.event === 'channel_start') {
      assembler.setChannelEpoch(event.channel as EngineChannel, event.epochMs as number)
    }
    if (event.event === 'timings') {
      segments.push(
        ...assembler.addTimings(event.channel as EngineChannel, event.tokens as EngineTokenTiming[])
      )
    }
  }
  let settled = 0
  const gate = new EchoOrderGate(deliver, () => settled)
  scenario(gated ? (event) => gate.push(event) : deliver, (sec) => {
    settled = sec
  })
  gate.release(true)
  segments.push(...assembler.flush())
  return segments
}

test('without ordering, a mic echo committed before the far side is missed', () => {
  const mic = assemble(false).filter((segment) => segment.channel === 'mic')
  assert.ok(
    mic.some((segment) => !segment.echo),
    'reproduces the missed echo'
  )
})

test('holding mic timings until the system channel settles flags the echo', () => {
  const mic = assemble(true).filter((segment) => segment.channel === 'mic')
  assert.ok(mic.length > 0)
  assert.ok(mic.every((segment) => segment.echo))
})

test('held mic timings are released once the system channel is settled past them', () => {
  const out: Array<Record<string, unknown>> = []
  let settled = 0
  const gate = new EchoOrderGate(
    (event) => out.push(event),
    () => settled
  )
  gate.push({ event: 'timings', channel: 'mic', tokens: words('hello there', 1) })
  assert.equal(out.length, 0)
  settled = 3
  gate.push({ event: 'timings', channel: 'system', tokens: [] })
  assert.deepEqual(
    out.map((event) => event.channel),
    ['system', 'mic']
  )
  // Partials and the mic final are never held behind each other.
  gate.push({ event: 'partial', channel: 'mic', text: 'x' })
  assert.equal(out.at(-1)?.event, 'partial')
})
