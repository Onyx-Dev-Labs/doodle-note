// Word error rate with one stated normalization, shared by the Windows and Mac
// benchmark runners so their numbers are comparable.
//
// Normalization "dn-asr-v1" (applied identically to reference and hypothesis):
//  1. Unicode NFKC, lower case, curly quotes to straight quotes.
//  2. Bracketed annotations ([laughter], <unk>, (inaudible)) are removed.
//  3. Numbers are spelled out as English words: "749" -> "seven hundred forty
//     nine", "10:30" -> "ten thirty", "3.5" -> "three point five", "2nd" ->
//     "second", "25%" -> "twenty five percent", "$5" -> "five dollars", and
//     four-digit numbers from 1100 to 2099 read as years ("1990" ->
//     "nineteen ninety", "2005" -> "two thousand five", "1,200" -> "twelve
//     hundred").
//  4. "&" -> "and"; hyphens, slashes and other punctuation become spaces;
//     apostrophes inside words are kept ("don't"), others removed.
//  5. Hesitations are removed: uh, um, er, erm, ah, eh, hm, hmm, mm, mhm,
//     mm-hmm, uh-huh, um-hum.
//  6. Spelling variants: "ok" -> "okay", "alright" -> "all right".
// Casing and punctuation therefore do not count as errors; whether a model
// produces them is reported separately (hasCase/hasPunctuation).

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen'
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ORDINAL = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth',
  twelve: 'twelfth'
}

function underHundred(n) {
  if (n < 20) return ONES[n]
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
}

function underThousand(n) {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts = []
  if (hundreds) parts.push(ONES[hundreds] + ' hundred')
  if (rest || !hundreds) parts.push(underHundred(rest))
  return parts.join(' ')
}

function cardinal(n) {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n === 0) return 'zero'
  const scales = [
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand']
  ]
  const parts = []
  let rest = n
  for (const [value, name] of scales) {
    if (rest >= value) {
      parts.push(underThousand(Math.floor(rest / value)) + ' ' + name)
      rest %= value
    }
  }
  if (rest) parts.push(underThousand(rest))
  return parts.join(' ')
}

function year(n) {
  if (n >= 2000 && n < 2010) return cardinal(n)
  const high = Math.floor(n / 100)
  const low = n % 100
  if (low === 0) return underHundred(high) + ' hundred'
  return underHundred(high) + ' ' + (low < 10 ? 'oh ' + ONES[low] : underHundred(low))
}

function ordinal(n) {
  const words = cardinal(n).split(' ')
  const last = words.pop()
  let converted = ORDINAL[last]
  if (!converted) converted = last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th'
  return [...words, converted].join(' ')
}

function digitsToWords(text) {
  return (
    text
      // 1,000,000 -> 1000000
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .replace(/\$(\d+(?:\.\d+)?)/g, '$1 dollars')
      .replace(/(\d)%/g, '$1 percent')
      .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) =>
        `${cardinal(Number(h))} ${Number(m) === 0 ? "o'clock" : Number(m) < 10 ? 'oh ' + cardinal(Number(m)) : cardinal(Number(m))}`
      )
      .replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n) => ordinal(Number(n)))
      .replace(/\b(\d+)\.(\d+)\b/g, (_, a, b) =>
        `${cardinal(Number(a))} point ${b.split('').map((d) => ONES[Number(d)]).join(' ')}`
      )
      .replace(/\b\d+\b/g, (digits) => {
        const n = Number(digits)
        if (digits.length === 4 && n >= 1100 && n < 2100) return year(n)
        if (digits.length > 1 && digits.startsWith('0')) {
          return digits.split('').map((d) => ONES[Number(d)]).join(' ')
        }
        return cardinal(n)
      })
  )
}

const HESITATIONS = new Set([
  'uh', 'um', 'er', 'erm', 'ah', 'eh', 'hm', 'hmm', 'mm', 'mhm', 'mmhmm', 'mm-hmm', 'uh-huh',
  'um-hum', 'uhhuh', 'mmm'
])
const VARIANTS = { ok: 'okay', alright: 'all right' }

function normalize(text) {
  let t = String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\[[^\]]*\]|<[^>]*>|\([^)]*\)/g, ' ')
  t = digitsToWords(t)
  t = t.replace(/&/g, ' and ')
  const words = []
  for (const raw of t.split(/\s+/)) {
    if (!raw) continue
    if (HESITATIONS.has(raw.replace(/[^a-z'-]/g, ''))) continue
    for (const piece of raw.split(/[^a-z0-9']+/)) {
      const word = piece.replace(/^'+|'+$/g, '')
      if (!word || HESITATIONS.has(word)) continue
      const variant = VARIANTS[word]
      if (variant) words.push(...variant.split(' '))
      else words.push(word)
    }
  }
  return words
}

/** Levenshtein alignment over words; returns error counts. */
function align(ref, hyp) {
  const n = ref.length
  const m = hyp.length
  let prev = new Uint32Array(m + 1)
  let cur = new Uint32Array(m + 1)
  // Keep the full backtrace only for small inputs; long-file WER needs counts only.
  const trace = n * m <= 4e6 ? new Uint8Array((n + 1) * (m + 1)) : null
  for (let j = 0; j <= m; j++) {
    prev[j] = j
    if (trace) trace[j] = 2
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i
    if (trace) trace[i * (m + 1)] = 1
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
      const del = prev[j] + 1
      const ins = cur[j - 1] + 1
      let best = sub
      let op = 0
      if (del < best) {
        best = del
        op = 1
      }
      if (ins < best) {
        best = ins
        op = 2
      }
      cur[j] = best
      if (trace) trace[i * (m + 1) + j] = op
    }
    ;[prev, cur] = [cur, prev]
  }
  const distance = prev[m]
  let substitutions = 0
  let deletions = 0
  let insertions = 0
  if (trace) {
    let i = n
    let j = m
    while (i > 0 || j > 0) {
      const op = trace[i * (m + 1) + j]
      if (i > 0 && j > 0 && op === 0) {
        if (ref[i - 1] !== hyp[j - 1]) substitutions++
        i--
        j--
      } else if (i > 0 && (op === 1 || j === 0)) {
        deletions++
        i--
      } else {
        insertions++
        j--
      }
    }
  }
  return { distance, substitutions, deletions, insertions }
}

function score(reference, hypothesis) {
  const ref = normalize(reference)
  const hyp = normalize(hypothesis)
  const { distance, substitutions, deletions, insertions } = align(ref, hyp)
  return {
    refWords: ref.length,
    hypWords: hyp.length,
    errors: distance,
    substitutions,
    deletions,
    insertions,
    wer: ref.length ? distance / ref.length : hyp.length ? 1 : 0,
    hasCase: /[A-Z]/.test(hypothesis) && /[a-z]/.test(hypothesis),
    hasPunctuation: /[.,?!]/.test(hypothesis)
  }
}

/** Corpus WER: total errors over total reference words. */
function aggregate(scores) {
  const total = scores.reduce(
    (sum, s) => ({ refWords: sum.refWords + s.refWords, errors: sum.errors + s.errors }),
    { refWords: 0, errors: 0 }
  )
  return { ...total, wer: total.refWords ? total.errors / total.refWords : 0, count: scores.length }
}

module.exports = { NORMALIZATION: 'dn-asr-v1', normalize, score, aggregate, align, cardinal }
