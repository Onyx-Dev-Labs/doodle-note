/**
 * End-to-end proof of long-meeting map-reduce against the REAL local model:
 * a synthetic ~2-hour transcript with distinctive facts planted at the
 * beginning, MIDDLE, and end. The old head+tail truncation silently dropped
 * the middle — this passes only when middle facts reach the final notes.
 *
 * Run: pnpm --filter @repo/ai long-meeting-smoke
 * Point at existing models: DOODLE_MODELS_DIR=... (defaults to the app's dir)
 */
import os from 'node:os'
import path from 'node:path'
import { LOCAL_MODELS } from '../src/catalog'
import { LocalNotesEngine } from '../src/local-engine'
import { chunkSegments } from '../src/map-reduce'
import { formatTranscript } from '../src/prompt'
import type { MergeInput, MergeSegment } from '../src/types'

const FILLER = [
  'Right, and I think if we look at how the process worked last quarter, there were a few places where the handoffs between the teams took longer than they should have, so we want to be careful about that.',
  'That makes sense to me. I would just add that we should keep the documentation current as we go, because catching it up afterwards never actually happens in practice.',
  'Can we go back to the earlier point for a second? I want to make sure we all have the same understanding of what was agreed before we move on to the next item on the list.',
  'Yes, and the feedback from the field has been generally positive, though there are a couple of edge cases people keep running into that we should probably write up properly.',
  'Let me share my screen for a moment. As you can see on this slide, the trend has been fairly steady over the last six weeks with a small bump around the middle of the period.'
]

/** Distinctive planted facts — each must survive into the final notes. */
const PLANTED = {
  early: 'The security audit budget is approved at exactly two hundred fifty thousand dollars.',
  middleDate: 'Important decision: the Northwind launch date moves to March fourteenth.',
  middleOwner: 'Priya Raman owns the vendor contract renewal with Datacore.',
  late: 'Final action item: Miguel sends the revised rollout plan to everyone by next Friday.'
}

function buildSegments(): MergeSegment[] {
  const segments: MergeSegment[] = []
  const push = (text: string): void => {
    segments.push({
      speaker: segments.length % 2 === 0 ? 'You' : 'Them',
      text,
      startMs: segments.length * 20_000
    })
  }
  const fillerBlock = (count: number): void => {
    for (let i = 0; i < count; i++) push(FILLER[i % FILLER.length]!)
  }
  fillerBlock(5)
  push(PLANTED.early)
  fillerBlock(190) // ~first half
  push(PLANTED.middleDate)
  fillerBlock(10)
  push(PLANTED.middleOwner)
  fillerBlock(190) // ~second half
  push(PLANTED.late)
  fillerBlock(5)
  return segments
}

const segments = buildSegments()
const input: MergeInput = {
  title: 'Northwind program review (marathon)',
  durationMs: segments.length * 20_000,
  rawNotesMarkdown: '- launch date?? \n- who owns datacore renewal',
  segments
}

const transcriptChars = formatTranscript(segments).length
const chunks = chunkSegments(segments).length
console.log(`transcript: ${segments.length} segments, ${transcriptChars} chars → ${chunks} chunks`)

const modelsDir =
  process.env.DOODLE_MODELS_DIR ??
  path.join(os.homedir(), 'Library', 'Application Support', 'desktop', 'models')
const engine = new LocalNotesEngine({ modelUri: LOCAL_MODELS[0]!.uri, modelsDir })

const started = Date.now()
const result = await engine.generateNotes(input, undefined, (progress) => {
  console.log(
    progress.phase === 'condensing'
      ? `condensing part ${progress.current}/${progress.total}…`
      : 'writing final notes…'
  )
})
console.log(`\n===== NOTES (${result.engine}, ${Math.round((Date.now() - started) / 1000)}s) =====\n`)
console.log(result.markdown)

const notes = result.markdown.toLowerCase()
const checks: Array<[string, boolean]> = [
  ['early fact ($250,000 audit budget)', /250|two hundred fifty/.test(notes)],
  ['MIDDLE fact (March 14 launch)', /march (fourteenth|14)/.test(notes)],
  ['MIDDLE fact (Priya owns Datacore renewal)', notes.includes('priya')],
  ['late fact (Miguel, Friday)', notes.includes('miguel')]
]
console.log('\n===== PLANTED-FACT CHECKS =====')
let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}
await engine.dispose()
if (failed > 0) {
  console.error(`\n${failed} planted fact(s) missing from the notes`)
  process.exit(1)
}
console.log('\nAll planted facts survived — including the middle the old code dropped.')
