import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_DICTIONARY_ENTRIES,
  applyDictionary,
  looksLikeMisrecognition,
  mergeLearned,
  normalizeDictionary,
  readEdits,
  sanitizePhrase,
  type DictionaryEntry
} from '../shared/dictation-dictionary'

const entry = (from: string, to: string, over: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  id: `id-${from}-${to}`,
  from,
  to,
  source: 'manual',
  count: 1,
  at: 1,
  ...over
})

test('a correction replaces the heard word, whole word only, in any case', () => {
  const dictionary = [entry('alec', 'Alex')]
  assert.equal(applyDictionary('Tell Alec to call', dictionary), 'Tell Alex to call')
  assert.equal(applyDictionary('alec is here', dictionary), 'Alex is here')
  assert.equal(applyDictionary("Alec's laptop", dictionary), "Alex's laptop")
  assert.equal(
    applyDictionary('the alecs and malec', dictionary),
    'the alecs and malec',
    'inside other words'
  )
  assert.equal(applyDictionary('', dictionary), '')
})

test('a lower-case spelling follows how the heard word was capitalised', () => {
  const dictionary = [entry('kubernetes cluster', 'k8s cluster'), entry('teh', 'the')]
  assert.equal(applyDictionary('Teh plan', dictionary), 'The plan')
  assert.equal(applyDictionary('TEH PLAN', dictionary), 'THE PLAN')
  assert.equal(applyDictionary('use the kubernetes   cluster', dictionary), 'use the k8s cluster')
})

test('an entry with no heard side fixes the spelling wherever the letters appear', () => {
  const dictionary = [entry('', 'DoodleNote'), entry('', 'macOS')]
  assert.equal(applyDictionary('open doodlenote on macos', dictionary), 'open DoodleNote on macOS')
})

test('one pass: an output is never matched again by another entry', () => {
  const dictionary = [entry('alec', 'alex'), entry('alex', 'alexander')]
  assert.equal(applyDictionary('alec and alex', dictionary), 'alex and alexander')
})

test('the longest phrase wins, and a correction beats a plain spelling for the same words', () => {
  const dictionary = [
    entry('new york', 'NYC'),
    entry('york', 'York'),
    entry('', 'Alex'),
    entry('alex', 'Alexa')
  ]
  assert.equal(applyDictionary('new york and york', dictionary), 'NYC and York')
  assert.equal(applyDictionary('call alex', dictionary), 'call Alexa')
})

test('regex characters in an entry are plain text', () => {
  assert.equal(applyDictionary('see c++ code', [entry('c++', 'C++')]), 'see C++ code')
  assert.equal(applyDictionary('a.b', [entry('a.b', 'x')]), 'x')
})

test('entries are validated, bounded and de-duplicated', () => {
  assert.equal(sanitizePhrase('  two   words '), 'two words')
  assert.equal(sanitizePhrase('one\ntwo'), null)
  assert.equal(sanitizePhrase('a b c d e'), null)
  assert.equal(sanitizePhrase('x'.repeat(61)), null)
  assert.equal(sanitizePhrase(7), null)
  const list = normalizeDictionary([
    { from: 'alec', to: 'Alex', source: 'learned', count: 3, at: 5 },
    { from: 'ALEC', to: 'Alex' },
    { from: 'same', to: 'same' },
    { from: 'bad\nline', to: 'x' },
    { from: '', to: 'Spelling' },
    'junk',
    null
  ])
  assert.deepEqual(
    list.map((e) => [e.from, e.to, e.source, e.count]),
    [
      ['alec', 'Alex', 'learned', 3],
      ['', 'Spelling', 'manual', 1]
    ]
  )
  assert.ok(list.every((e) => e.id.length > 0))
  assert.deepEqual(normalizeDictionary('nope'), [])
  const many = Array.from({ length: MAX_DICTIONARY_ENTRIES + 20 }, (_, i) => ({
    from: `w${i}x`,
    to: `W${i}`
  }))
  assert.equal(normalizeDictionary(many).length, MAX_DICTIONARY_ENTRIES)
})

test('what counts as a misheard word, and what does not', () => {
  assert.equal(looksLikeMisrecognition('Alec', 'Alex'), true)
  assert.equal(looksLikeMisrecognition('doodle note', 'DoodleNote'), true)
  assert.equal(looksLikeMisrecognition('Priya', 'Pria'), true)
  assert.equal(looksLikeMisrecognition('Thursday', 'Friday'), false, 'a change of mind')
  assert.equal(looksLikeMisrecognition('three', '3'), false, 'numbers')
  assert.equal(looksLikeMisrecognition('to', 'too'), false, 'everyday word')
  assert.equal(looksLikeMisrecognition('their', 'there'), false, 'everyday homophone')
  assert.equal(looksLikeMisrecognition('meeting', 'call'), false)
  assert.equal(looksLikeMisrecognition('alex', 'Alex'), false, 'case only')
})

test('an edited word is found, and an untouched message teaches nothing', () => {
  const said = 'Tell Alec the report is ready'
  const edited = readEdits(said, 'Tell Alex the report is ready')
  assert.equal(edited.found, true)
  assert.deepEqual(edited.pairs, [{ from: 'Alec', to: 'Alex' }])
  const same = readEdits(said, 'Hi there. Tell Alec the report is ready. Thanks!')
  assert.deepEqual(same, { found: true, pairs: [], untouched: true })
})

test('the field may hold other text around the inserted words', () => {
  const said = 'ask Alec to send the budget before Friday'
  const field = 'Morning all,\n\nask Alex to send the budget before Friday\n\nthanks, Sam'
  assert.deepEqual(readEdits(said, field).pairs, [{ from: 'Alec', to: 'Alex' }])
})

test('an added or deleted word is an edit, not a correction', () => {
  const said = 'please send the report to Alec today'
  assert.deepEqual(readEdits(said, 'please send the final report to Alec today').pairs, [])
  assert.deepEqual(readEdits(said, 'please send the report to Alec').pairs, [])
})

test('a change of mind is not learned', () => {
  const reading = readEdits('lets meet on Thursday at noon', 'lets meet on Friday at noon')
  assert.equal(reading.found, true)
  assert.deepEqual(reading.pairs, [])
})

test('a rewrite or another message teaches nothing and is reported as not found', () => {
  const said = 'tell Alec the report is ready'
  assert.equal(readEdits(said, '').found, false)
  assert.equal(readEdits(said, 'something else entirely, unrelated words here').found, false)
  const rewritten = readEdits(
    'alec sent the quarterly report yesterday evening after work',
    'alex sent teh quartely rport yesterdy evenin afer wrk'
  )
  assert.deepEqual(rewritten.pairs, [], 'too much changed at once')
})

test('two corrections in one message are both found', () => {
  const said = 'Alec and Priya reviewed the new budget with Jonathon yesterday'
  const field = 'Alex and Priya reviewed the new budget with Jonathan yesterday'
  assert.deepEqual(readEdits(said, field).pairs, [
    { from: 'Alec', to: 'Alex' },
    { from: 'Jonathon', to: 'Jonathan' }
  ])
})

test('a multi-word phrase corrected to one word', () => {
  const said = 'open the doodle note app and start a new meeting'
  const field = 'open the DoodleNote app and start a new meeting'
  assert.deepEqual(readEdits(said, field).pairs, [{ from: 'doodle note', to: 'DoodleNote' }])
})

test('learned pairs are added once, confirmed on a repeat, and never overwrite a hand-made entry', () => {
  const first = mergeLearned([], [{ from: 'Alec', to: 'Alex' }], 100)
  assert.deepEqual(first.added, [{ from: 'Alec', to: 'Alex' }])
  assert.equal(first.entries[0]?.source, 'learned')
  const again = mergeLearned(first.entries, [{ from: 'alec', to: 'Alex' }], 200)
  assert.deepEqual(again.added, [])
  assert.equal(again.entries[0]?.count, 2)
  const changed = mergeLearned(again.entries, [{ from: 'alec', to: 'Alexa' }], 300)
  assert.equal(
    changed.entries[0]?.to,
    'Alexa',
    'a newer learned spelling replaces an older learned one'
  )
  const manual = [entry('alec', 'Alex')]
  const kept = mergeLearned(manual, [{ from: 'alec', to: 'Alexa' }], 400)
  assert.equal(kept.entries[0]?.to, 'Alex')
  assert.deepEqual(kept.added, [])
  assert.deepEqual(mergeLearned([], [{ from: 'x'.repeat(80), to: 'y' }], 1).entries, [])
})
