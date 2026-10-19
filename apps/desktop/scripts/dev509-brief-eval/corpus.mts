import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import type { SourceAnchor } from '@repo/meetings-store/source-contract'

export const CORPUS_SHA256 = 'e6e14b38187cd3ede5daca987177a614243f664864f6520e44393689663583e8'
export const RUBRIC_SHA256 = 'e25080c419a4d6f10cfeee5a77573792895bdb95d9526d95bf20b01da70fd0c6'
export const corpusPath = fileURLToPath(
  new URL('../../../../docs/qa/dev509/brief-corpus-v1.json', import.meta.url)
)
export const rubricPath = fileURLToPath(
  new URL('../../../../docs/qa/dev509/brief-quality-rubric-v1.md', import.meta.url)
)
export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')
export interface Original {
  id: string
  title: string
  rawNotesMarkdown?: string
  segments?: Array<{ id: string; channel: string; speaker: string; text: string }>
  startedAt?: string
  createdAt?: string
  enhancedMarkdown: string
  syntheticExtension: { preserve: boolean }
}
export interface Gold {
  meetingId: string
  kind: 'personal' | 'transcript'
  sourceId: string
  startUtf16: number
  endUtf16: number
  quote: string
  occurredAt: string | null
  dateBasis: 'startedAt' | 'createdAt' | 'unknown'
}
export interface Scenario {
  id: string
  group: 'clear' | 'absent-unknown' | 'conflicting-fulfilled' | 'injection-forged'
  topic: string
  eventSubject: string
  provider: 'google' | 'microsoft'
  identityMode: 'person' | 'unassigned' | 'unknown-roster' | 'resource' | 'self'
  selection: 'all' | 'none'
  originals: Original[]
  foreignOriginals: Original[]
  unlinkedFillerCount: number
  expected: {
    selectedMeetingIds: string[]
    modelCalls: number
    allowedSnapshotStatuses: string[]
    gold: Gold[]
    supportedFacts: string[]
    prohibitedClaims: string[]
    requiresHumanSupportReview: boolean
  }
}
export interface Corpus {
  version: 1
  synthetic: true
  frozenAgainst: string
  fixtureEpoch: string
  eventStart: string
  eventEnd: string
  personName: string
  personAddress: string
  accountSubjects: string[]
  cases: Scenario[]
}
export function readCorpus(path = corpusPath): Corpus {
  const bytes = readFileSync(path)
  assert.equal(
    sha256(bytes),
    CORPUS_SHA256,
    'Frozen corpus bytes changed; do not retune after evaluation.'
  )
  const corpus: Corpus = JSON.parse(bytes.toString('utf8'))
  assert.equal(corpus.cases.length, 24)
  assert.equal(new Set(corpus.cases.map((c) => c.id)).size, 24)
  assert.deepEqual(
    Object.fromEntries(
      ['clear', 'absent-unknown', 'conflicting-fulfilled', 'injection-forged'].map((g) => [
        g,
        corpus.cases.filter((c) => c.group === g).length
      ])
    ),
    { clear: 8, 'absent-unknown': 6, 'conflicting-fulfilled': 6, 'injection-forged': 4 }
  )
  return corpus
}
export function containsGold(
  range: { anchor: SourceAnchor; startUtf16: number; endUtf16: number; quote: string },
  gold: Gold
): boolean {
  return (
    range.anchor.meetingId === gold.meetingId &&
    range.anchor.sourceId === gold.sourceId &&
    range.anchor.kind === gold.kind &&
    range.startUtf16 <= gold.startUtf16 &&
    range.endUtf16 >= gold.endUtf16 &&
    range.quote.slice(gold.startUtf16 - range.startUtf16, gold.endUtf16 - range.startUtf16) ===
      gold.quote
  )
}

export function readRubric(path = rubricPath): Buffer {
  const bytes = readFileSync(path)
  assert.equal(
    sha256(bytes),
    RUBRIC_SHA256,
    'Frozen rubric bytes changed; do not retune after evaluation.'
  )
  return bytes
}
