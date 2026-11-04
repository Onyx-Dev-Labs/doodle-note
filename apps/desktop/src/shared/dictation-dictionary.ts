/**
 * The dictation dictionary: words the recognizer gets wrong and how to write
 * them. Pure functions only, so the same rules run in the main process, the
 * settings page and the tests.
 *
 * Two kinds of entry, both stored as { from, to }:
 *  - a correction ("Alec" is written "Alex"): `from` is what the recognizer
 *    tends to produce;
 *  - a spelling ("doodlenote" is written "DoodleNote", or just "DoodleNote"):
 *    an empty `from` means "whenever these letters appear, write them exactly
 *    like this".
 *
 * Learning from edits lives here too: given what was inserted and what the field
 * holds later, find the words the person changed and keep only the changes that
 * look like a misheard word, not a rewrite.
 */

export type DictionarySource = 'manual' | 'learned'

export interface DictionaryEntry {
  id: string
  /** What the recognizer produces; empty for a plain spelling. Matched whole-word, any case. */
  from: string
  /** How to write it. */
  to: string
  source: DictionarySource
  /** Times it was learned or re-confirmed; 1 for a hand-written entry. */
  count: number
  /** Epoch ms when added. */
  at: number
}

export const MAX_DICTIONARY_ENTRIES = 500
export const MAX_PHRASE_CHARS = 60
export const MAX_PHRASE_WORDS = 4

/** Collapse spaces; null when empty, too long, multi-line or not a short phrase. */
export function sanitizePhrase(input: unknown): string | null {
  if (typeof input !== 'string') return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) return null
  const phrase = input.replace(/\s+/g, ' ').trim()
  if (!phrase || phrase.length > MAX_PHRASE_CHARS) return null
  if (phrase.split(' ').length > MAX_PHRASE_WORDS) return null
  return phrase
}

const key = (phrase: string): string => phrase.replace(/\s+/g, ' ').trim().toLowerCase()

/** The same entry, for de-duplication: same words heard, same words written. */
const entryKey = (entry: Pick<DictionaryEntry, 'from' | 'to'>): string =>
  `${key(entry.from)}\u0001${entry.to}`

/** Coerce stored JSON into a valid, bounded, de-duplicated list. */
export function normalizeDictionary(input: unknown): DictionaryEntry[] {
  if (!Array.isArray(input)) return []
  const out: DictionaryEntry[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (out.length >= MAX_DICTIONARY_ENTRIES) break
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const to = sanitizePhrase(raw.to)
    const from = raw.from === '' || raw.from === undefined ? '' : sanitizePhrase(raw.from)
    if (to === null || from === null) continue
    // A correction that maps a phrase to itself does nothing.
    if (from !== '' && from === to) continue
    const entry: DictionaryEntry = {
      id: typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : '',
      from,
      to,
      source: raw.source === 'learned' ? 'learned' : 'manual',
      count:
        typeof raw.count === 'number' && Number.isFinite(raw.count) && raw.count >= 1
          ? Math.min(Math.floor(raw.count), 9999)
          : 1,
      at: typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0
    }
    const k = entryKey(entry)
    if (seen.has(k)) continue
    seen.add(k)
    if (!entry.id) entry.id = `dict-${out.length}-${entry.at}-${Math.abs(hash(k))}`
    out.push(entry)
  }
  return out
}

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  return h
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The replacement keeps the way the heard words were capitalised when `to` is all lower case. */
function matchCase(heard: string, to: string): string {
  if (to !== to.toLowerCase()) return to
  const letters = heard.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase()) return to.toUpperCase()
  const first = heard.charAt(0)
  if (first !== first.toLowerCase()) return to.charAt(0).toUpperCase() + to.slice(1)
  return to
}

/**
 * Apply the dictionary to dictated text in one pass, so one entry's output is
 * never re-matched by another. Whole words only, any case; the longest phrase
 * wins where two start at the same place.
 */
export function applyDictionary(text: string, entries: readonly DictionaryEntry[]): string {
  if (!text || entries.length === 0) return text
  // Correction entries take priority over plain spellings for the same words.
  const rules = new Map<string, { to: string; spelling: boolean }>()
  for (const entry of entries) {
    const heard = entry.from === '' ? key(entry.to) : key(entry.from)
    const spelling = entry.from === ''
    const existing = rules.get(heard)
    if (existing && !existing.spelling && spelling) continue
    rules.set(heard, { to: entry.to, spelling })
  }
  const phrases = [...rules.keys()].sort(
    (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length
  )
  if (phrases.length === 0) return text
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${phrases.map((p) => escapeRegExp(p).replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`,
    'giu'
  )
  return text.replace(pattern, (matched) => {
    const rule = rules.get(key(matched))
    if (!rule) return matched
    return rule.spelling ? rule.to : matchCase(matched, rule.to)
  })
}

/* ---- learning from edits ---- */

/** The words of a text, without punctuation; apostrophes and hyphens inside a word stay. */
export function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
}

/**
 * Function words and common homophones. A correction whose heard side is one of
 * these ("to" to "too") would rewrite every sentence, so it is never learned.
 */
const COMMON_WORDS = new Set(
  (
    'a an the and or but nor so yet if then than that this these those there their theirs they them ' +
    'theyre here hear he she it its itself we us our ours you your yours youre i me my mine am is are ' +
    'was were be been being do does did done doing have has had having will would can could shall ' +
    'should may might must to too two of in on at by buy bye for four with without from into onto ' +
    'out up down off over under again no know now not new one won on or our hour where wear were ' +
    'which witch what when who whom whose why how all any both each few more most other some such ' +
    'only own same very just also as about after before because between through during while ' +
    'right write rite weather whether whole hole see sea sun son week weak wait weight way weigh ' +
    'meet meat mail male made maid plain plane piece peace pair pear pare read red reed role roll ' +
    'sale sail some sum tail tale their there threw through wood would yes yeah ok okay hi hey'
  ).split(' ')
)

export const isCommonWord = (word: string): boolean => COMMON_WORDS.has(word.toLowerCase())

/** Levenshtein distance, two rows. */
function distance(a: string, b: string): number {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = row
  }
  return previous[b.length] ?? 0
}

/** 0..1: how alike two phrases look, ignoring case and spaces. */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/\s+/g, '')
  const y = b.toLowerCase().replace(/\s+/g, '')
  const longest = Math.max(x.length, y.length)
  return longest === 0 ? 1 : 1 - distance(x, y) / longest
}

/** A correction from the words the recognizer wrote to the words the person typed instead. */
export interface LearnedPair {
  from: string
  to: string
}

/**
 * Whether a changed phrase looks like a misheard word being fixed, as opposed to
 * the person changing what they meant to say.
 */
export function looksLikeMisrecognition(from: string, to: string): boolean {
  const heard = wordsOf(from)
  const typed = wordsOf(to)
  if (heard.length === 0 || heard.length > 3 || typed.length === 0 || typed.length > 3) return false
  const a = heard.join(' ')
  const b = typed.join(' ')
  if (a.toLowerCase() === b.toLowerCase()) return false
  // Numbers and short fragments change for reasons that are not spelling.
  if (/^[\d\s]+$/.test(a) || /^[\d\s]+$/.test(b)) return false
  if (a.replace(/\s/g, '').length < 3 || b.replace(/\s/g, '').length < 2) return false
  // A heard side made only of everyday words would be replaced everywhere.
  if (heard.every(isCommonWord)) return false
  if (heard.length === 1 && isCommonWord(a)) return false
  // Alec/Alex and Jonathon/Jonathan score 0.75 or more; Thursday/Friday score 0.5.
  return similarity(a, b) >= 0.6
}

type Step =
  | { op: 'match'; i: number; j: number }
  | { op: 'sub'; i: number; j: number }
  | { op: 'del'; i: number }
  | { op: 'ins'; j: number }

const MAX_INSERTED_WORDS = 400
const MAX_FIELD_WORDS = 6000

export interface EditReading {
  /** The inserted text was found in the field (most of its words, in order). */
  found: boolean
  /** Corrections that look like fixes of misheard words. Empty when untouched or when it was rewritten. */
  pairs: LearnedPair[]
  /** The words are unchanged. */
  untouched: boolean
}

const NOT_FOUND: EditReading = { found: false, pairs: [], untouched: false }

/**
 * Compare what was inserted with what the field holds now. The inserted words
 * are aligned against the best-matching stretch of the field (semi-global
 * alignment: the field may hold other text before and after), then each changed
 * stretch is judged by `looksLikeMisrecognition`.
 */
export function readEdits(inserted: string, current: string): EditReading {
  const before = wordsOf(inserted)
  const after = wordsOf(current)
  if (before.length === 0 || before.length > MAX_INSERTED_WORDS) return NOT_FOUND
  if (after.length === 0 || after.length > MAX_FIELD_WORDS) return NOT_FOUND
  const n = before.length
  const m = after.length
  const lower = (words: string[]): string[] => words.map((w) => w.toLowerCase())
  const a = lower(before)
  const b = lower(after)

  // Cheap exit: the words are there in a row, unchanged.
  const joinedA = a.join(' ')
  if (` ${b.join(' ')} `.includes(` ${joinedA} `))
    return { found: true, pairs: [], untouched: true }

  const width = m + 1
  const score = new Int16Array((n + 1) * width)
  const from = new Uint8Array((n + 1) * width) // 1 match/sub (diag), 2 del (up), 3 ins (left), 0 start
  const MATCH = 2
  const MISS = -1
  const GAP = -1
  // Leading gaps in the field are free: the inserted words may start anywhere in it.
  for (let i = 1; i <= n; i++) {
    score[i * width] = i * GAP
    from[i * width] = 2
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = (score[(i - 1) * width + j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? MATCH : MISS)
      const up = (score[(i - 1) * width + j] ?? 0) + GAP
      const left = (score[i * width + j - 1] ?? 0) + GAP
      let best = diag
      let dir = 1
      if (up > best) {
        best = up
        dir = 2
      }
      if (left > best) {
        best = left
        dir = 3
      }
      score[i * width + j] = best
      from[i * width + j] = dir
    }
  }
  // Trailing gaps in the field are free too: pick the best end in the last row.
  let endJ = 0
  let best = score[n * width] ?? 0
  for (let j = 1; j <= m; j++) {
    const value = score[n * width + j] ?? 0
    if (value > best) {
      best = value
      endJ = j
    }
  }
  const steps: Step[] = []
  let i = n
  let j = endJ
  while (i > 0) {
    const dir = from[i * width + j]
    if (dir === 1 && j > 0) {
      steps.push({ op: a[i - 1] === b[j - 1] ? 'match' : 'sub', i: i - 1, j: j - 1 })
      i--
      j--
    } else if (dir === 3 && j > 0) {
      steps.push({ op: 'ins', j: j - 1 })
      j--
    } else {
      steps.push({ op: 'del', i: i - 1 })
      i--
    }
  }
  steps.reverse()

  const matched = steps.filter((s) => s.op === 'match').length
  // Most of what was typed must still be there, or this is another message.
  if (matched < Math.max(2, Math.ceil(n * 0.5))) return NOT_FOUND

  const pairs: LearnedPair[] = []
  let changed = 0
  let k = 0
  while (k < steps.length) {
    if (steps[k]?.op === 'match') {
      k++
      continue
    }
    const heard: string[] = []
    const typed: string[] = []
    while (k < steps.length && steps[k]?.op !== 'match') {
      const step = steps[k] as Step
      if (step.op === 'sub' || step.op === 'del') heard.push(before[step.i] as string)
      if (step.op === 'sub' || step.op === 'ins') typed.push(after[step.j] as string)
      k++
    }
    changed += Math.max(heard.length, typed.length)
    // Words only added or only removed are the person editing, not correcting.
    if (heard.length === 0 || typed.length === 0) continue
    const pair = { from: heard.join(' '), to: typed.join(' ') }
    if (looksLikeMisrecognition(pair.from, pair.to)) pairs.push(pair)
  }
  // A rewrite changes too much to learn anything from.
  if (changed > Math.max(3, Math.floor(n * 0.4)))
    return { found: true, pairs: [], untouched: false }
  return { found: true, pairs, untouched: changed === 0 }
}

/** Add or re-confirm learned pairs; returns the new list and the pairs that were new. */
export function mergeLearned(
  entries: readonly DictionaryEntry[],
  pairs: readonly LearnedPair[],
  now: number
): { entries: DictionaryEntry[]; added: LearnedPair[] } {
  const next = entries.map((entry) => ({ ...entry }))
  const added: LearnedPair[] = []
  for (const pair of pairs) {
    const from = sanitizePhrase(pair.from)
    const to = sanitizePhrase(pair.to)
    if (!from || !to || from === to) continue
    const existing = next.find((entry) => key(entry.from) === key(from))
    if (existing) {
      // The same heard words already have a spelling: a repeat confirms it, a
      // different one replaces it only if it was learned (never a hand-made entry).
      if (existing.to === to) existing.count += 1
      else if (existing.source === 'learned') {
        existing.to = to
        existing.count = 1
        existing.at = now
        added.push({ from, to })
      }
      continue
    }
    if (next.length >= MAX_DICTIONARY_ENTRIES) continue
    next.push({
      id: `dict-${now}-${Math.abs(hash(`${from}\u0001${to}`))}`,
      from,
      to,
      source: 'learned',
      count: 1,
      at: now
    })
    added.push({ from, to })
  }
  return { entries: next, added }
}
