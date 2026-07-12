import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHUNK_SYSTEM_PROMPT, chunkSegments, generateMeetingNotes } from './map-reduce'
import { formatTranscript } from './prompt'
import type { MergedNotes, MergeInput, MergeSegment, NotesEngine, NotesProgress } from './types'

function makeSegments(count: number, textLength = 400): MergeSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    speaker: i % 2 === 0 ? ('You' as const) : ('Them' as const),
    text: `segment ${i} ${'word '.repeat(Math.ceil(textLength / 5))}`.slice(0, textLength),
    startMs: i * 10_000
  }))
}

/** Records every runRaw call; fails the calls listed in failOn (1-based). */
class FakeEngine implements NotesEngine {
  id = 'fake'
  label = 'Fake'
  singlePassThresholdChars?: number
  calls: Array<{ system: string; prompt: string }> = []
  failOn = new Set<number>()

  async runRaw(system: string, prompt: string, onToken?: (t: string) => void): Promise<MergedNotes> {
    this.calls.push({ system, prompt })
    if (this.failOn.has(this.calls.length)) throw new Error(`call ${this.calls.length} failed`)
    onToken?.('notes')
    return { markdown: `output-${this.calls.length}`, engine: this.id, elapsedMs: 1 }
  }
  generateNotes(input: MergeInput, onToken?: (t: string) => void, onProgress?: (p: NotesProgress) => void) {
    return generateMeetingNotes(this, input, onToken, onProgress)
  }
  askQuestion(): Promise<MergedNotes> {
    throw new Error('unused')
  }
  askAcrossMeetings(): Promise<MergedNotes> {
    throw new Error('unused')
  }
}

const baseInput = (segments: MergeSegment[]): MergeInput => ({
  title: 'Quarterly review',
  rawNotesMarkdown: 'pricing decision!',
  segments
})

describe('chunkSegments', () => {
  it('short input stays one chunk', () => {
    const chunks = chunkSegments(makeSegments(5))
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0]!.length, 5)
  })

  it('cuts only at segment boundaries and covers every segment in order', () => {
    const segments = makeSegments(300)
    const chunks = chunkSegments(segments)
    assert.ok(chunks.length > 1)
    // Every original segment appears, in order, ignoring the overlap repeats.
    let cursor = 0
    for (const chunk of chunks) {
      for (const segment of chunk) {
        const index = segments.indexOf(segment)
        assert.ok(index >= 0)
        if (index === cursor) cursor += 1
      }
    }
    assert.equal(cursor, segments.length)
  })

  it('chunks after the first begin with overlap from the previous one', () => {
    const chunks = chunkSegments(makeSegments(300))
    for (let i = 1; i < chunks.length; i++) {
      const previousTail = chunks[i - 1]!.at(-1)!
      assert.ok(chunks[i]!.includes(previousTail), `chunk ${i} carries overlap`)
    }
  })

  it('respects the target size within one oversize segment', () => {
    const chunks = chunkSegments(makeSegments(200), 10_000, 500)
    for (const chunk of chunks) {
      const size = formatTranscript(chunk).length
      assert.ok(size < 12_000, `chunk of ${size} chars stays near target`)
    }
  })
})

describe('generateMeetingNotes', () => {
  it('short transcripts run single-pass with the merge prompt', async () => {
    const engine = new FakeEngine()
    const result = await engine.generateNotes(baseInput(makeSegments(10)))
    assert.equal(engine.calls.length, 1)
    assert.match(engine.calls[0]!.system, /note-writing engine/)
    assert.match(engine.calls[0]!.prompt, /=== TRANSCRIPT ===/)
    assert.equal(result.markdown, 'output-1')
  })

  it('long transcripts condense every chunk then reduce', async () => {
    const engine = new FakeEngine()
    const progress: NotesProgress[] = []
    const segments = makeSegments(300) // ~124K chars formatted
    await engine.generateNotes(baseInput(segments), undefined, (p) => progress.push(p))

    const condenseCalls = engine.calls.filter((c) => c.system === CHUNK_SYSTEM_PROMPT)
    assert.ok(condenseCalls.length >= 3, `condensed in ${condenseCalls.length} parts`)
    const reduce = engine.calls.at(-1)!
    assert.match(reduce.system, /note-writing engine/)
    assert.match(reduce.prompt, /CONDENSED TRANSCRIPT NOTES/)
    assert.match(reduce.prompt, /pricing decision!/)
    // Progress: one condensing tick per chunk, then the writing phase.
    assert.equal(progress.filter((p) => p.phase === 'condensing').length, condenseCalls.length)
    assert.equal(progress.at(-1)!.phase, 'writing')
  })

  it('every chunk feeds the reduce pass', async () => {
    const engine = new FakeEngine()
    await engine.generateNotes(baseInput(makeSegments(300)))
    const reduce = engine.calls.at(-1)!
    const condenseCount = engine.calls.length - 1
    for (let i = 1; i <= condenseCount; i++) {
      assert.match(reduce.prompt, new RegExp(`output-${i}\\b`))
    }
  })

  it('a failed chunk degrades to a marked gap, not a failed run', async () => {
    const engine = new FakeEngine()
    engine.failOn = new Set([2])
    const result = await engine.generateNotes(baseInput(makeSegments(300)))
    assert.ok(result.markdown.length > 0)
    const reduce = engine.calls.at(-1)!
    assert.match(reduce.prompt, /condensation failed/)
  })

  it('fails only when every chunk fails', async () => {
    const engine = new FakeEngine()
    const segments = makeSegments(300)
    const chunkCount = chunkSegments(segments).length
    engine.failOn = new Set(Array.from({ length: chunkCount }, (_, i) => i + 1))
    await assert.rejects(() => engine.generateNotes(baseInput(segments)), /every part/)
  })

  it('tokens stream only from the final pass', async () => {
    const engine = new FakeEngine()
    const tokens: string[] = []
    await engine.generateNotes(baseInput(makeSegments(300)), (t) => tokens.push(t))
    assert.equal(tokens.length, 1) // reduce pass only, not per chunk
  })

  it('a higher engine threshold keeps medium meetings single-pass', async () => {
    const engine = new FakeEngine()
    engine.singlePassThresholdChars = 400_000
    await engine.generateNotes(baseInput(makeSegments(300)))
    assert.equal(engine.calls.length, 1)
    // And the message respects the wider budget instead of 48K truncation.
    assert.doesNotMatch(engine.calls[0]!.prompt, /middle of a long transcript omitted/)
  })
})
