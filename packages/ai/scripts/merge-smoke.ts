/**
 * End-to-end proof of the local-first notes pipeline: downloads the smallest
 * catalog model if needed (the same code path onboarding will use), then
 * merges realistic rough notes + transcript segments into polished notes.
 *
 * Run: pnpm --filter @repo/ai merge-smoke
 * Override the model: DOODLE_MODEL_URI=hf:... pnpm --filter @repo/ai merge-smoke
 */
import { LOCAL_MODELS, totalRamGB } from '../src/catalog'
import { LocalNotesEngine } from '../src/local-engine'
import type { MergeInput } from '../src/types'

const input: MergeInput = {
  title: 'Quarterly planning — ops team',
  durationMs: 32 * 60 * 1000,
  rawNotesMarkdown: `- ticketing cutover aug 15?? confirm w/ vendor
- henderson onboarding — marcus owns it
- switches: ask about budget, ~12k?
- WATCH: backup jobs failing since tuesday`,
  segments: [
    { speaker: 'Them', startMs: 24_000, text: 'Good morning everyone, thanks for joining the quarterly planning meeting. Today we need to cover three topics: the migration to the new ticketing system, onboarding for the Henderson account, and the budget review for network hardware upgrades.' },
    { speaker: 'You', startMs: 61_000, text: 'Before we start, quick flag: the overnight backup jobs have been failing since Tuesday. I want a decision on who picks that up.' },
    { speaker: 'Them', startMs: 78_000, text: 'Good catch. Let us have Priya own the backup investigation this week and report back Friday.' },
    { speaker: 'Them', startMs: 112_000, text: 'On the ticketing migration: the vendor says data import is ready. I am proposing we cut over the weekend of August fifteenth.' },
    { speaker: 'You', startMs: 141_000, text: 'August fifteenth works if we freeze ticket categories two weeks before. I will confirm the final date with the vendor tomorrow.' },
    { speaker: 'Them', startMs: 163_000, text: 'Agreed, freeze on August first then. Next, Henderson. They signed for forty seats and onboarding needs to finish before their fiscal year starts October one.' },
    { speaker: 'You', startMs: 199_000, text: 'Marcus should own Henderson onboarding, he ran the last two. I will pair with him on the network assessment during week one.' },
    { speaker: 'Them', startMs: 224_000, text: 'Done, Marcus owns it. Last topic: the switch refresh. Quotes came in at roughly twelve thousand for the three sites.' },
    { speaker: 'You', startMs: 251_000, text: 'Is that within this quarter’s budget, or do we split it across two quarters?' },
    { speaker: 'Them', startMs: 262_000, text: 'We will split it: sites one and two this quarter, site three in January. I will get the revised quote approved by finance next week.' }
  ]
}

const ram = totalRamGB()
const spec =
  process.env['DOODLE_MODEL_URI'] !== undefined
    ? { id: 'custom', label: 'custom', uri: process.env['DOODLE_MODEL_URI']!, sizeGB: 0, minRamGB: 0, description: '' }
    : LOCAL_MODELS[0]! // smallest model for the smoke — onboarding picks by RAM

console.log(`machine RAM: ${ram}GB — model: ${spec.uri}`)
let lastPct = -1
const engine = new LocalNotesEngine({
  modelUri: spec.uri,
  onDownloadProgress: (f) => {
    const pct = Math.floor(f * 10) * 10
    if (pct > lastPct) {
      lastPct = pct
      console.log(`downloading model… ${pct}%`)
    }
  }
})

console.log('preparing engine (downloads on first run)…')
await engine.prepare()
console.log('generating notes…')
const result = await engine.generateNotes(input)
console.log('\n================ MERGED NOTES ================\n')
console.log(result.markdown)
console.log('\n==============================================')
console.log(`engine: ${result.engine}`)
console.log(`elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s`)
await engine.dispose()
