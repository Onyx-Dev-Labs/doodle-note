/**
 * "Light" tidy-up for dictated text: deterministic, no model, instant. It removes
 * the noise of speech (um, uh, stutters, repeated words, spoken self-corrections),
 * turns a spoken list into bullets and fixes capitalisation and the final full
 * stop. It is conservative on purpose: when a rule is not sure, it leaves the
 * words alone, because a wrong "fix" to a name or a number is worse than a stray
 * "you know". English only; text that does not look English passes through
 * untouched, apart from whitespace.
 */

/** Common English words, to recognise English even in a short phrase. */
const ENGLISH_WORDS = new Set(
  (
    'the and to of is it that you in for on with this we are my be have not was but they can will ' +
    'just if at as do what there when would about from out how an or all then want need think ' +
    "going know i i'm i've i'll i'd it's that's don't can't won't didn't isn't let's our your their " +
    'them these those because should could which who why where been were has had does did ' +
    'okay yeah really maybe also very some any more most than too here send tomorrow today meeting'
  ).split(' ')
)

/** Function words that belong to the big Latin-script languages and are not English words. */
const FOREIGN_WORDS = new Set(
  (
    'el los las una uno es por para con pero como esto está hola gracias ' +
    'le les des une est pas pour dans qui que bonjour merci très ' +
    'der die das ist und nicht ein eine mit sich auch wir ich sie danke ' +
    'uma não você com os mais obrigado ' +
    'che sono per della gli ciao grazie'
  ).split(' ')
)

/**
 * True unless the text looks like another language: a non-Latin script, accented
 * words with no English in them, or a share of clearly foreign function words.
 * Text with no evidence either way counts as English.
 */
export function looksEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return true
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0
  if (latin / letters.length < 0.9) return false
  const words = text.toLowerCase().match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? []
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length
  const foreign = words.filter((word) => FOREIGN_WORDS.has(word)).length
  if (/[\u00C0-\u024F]/.test(text) && english / words.length < 0.4) return false
  if (foreign > english && foreign / words.length >= 0.2) return false
  return true
}

/* ---- protected tokens: URLs, e-mail, file names, code identifiers ---- */

const PROTECTED = new RegExp(
  [
    '`[^`\\n]*`',
    'https?:\\/\\/[^\\s]*[^\\s.,;:!?)\\]]',
    'www\\.[^\\s]*[^\\s.,;:!?)\\]]',
    '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+',
    '\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:com|org|net|io|dev|ai|app|co|edu|gov|me|us|uk|de|fr)\\b(?:\\/[^\\s]*[^\\s.,;:!?)])?',
    '\\b[\\w-]+\\.(?:js|ts|tsx|jsx|py|rb|go|rs|java|cpp|h|md|json|ya?ml|txt|sh|css|html|swift)\\b',
    '\\b[a-z0-9]+(?:_[a-z0-9]+)+\\b',
    '\\b[a-z]+(?:[A-Z][a-z0-9]*)+\\b',
    '(?<![\\w])\\/[\\w.-]+(?:\\/[\\w.-]+)*'
  ].join('|'),
  'g'
)

const OPEN = '\u0001'
const CLOSE = '\u0002'

/** Swap protected tokens for placeholders so no rule below can touch them. */
export function protectTokens(text: string): { text: string; restore: (s: string) => string } {
  const saved: string[] = []
  const swapped = text.replace(PROTECTED, (match) => {
    saved.push(match)
    return `${OPEN}${saved.length - 1}${CLOSE}`
  })
  return {
    text: swapped,
    restore: (s) => s.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, i) => saved[Number(i)])
  }
}

/* ---- fillers ---- */

function tidySpacing(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[,;:])/g, '')
    .replace(/(^|\n)\s*[,;]\s*/g, '$1')
    .replace(/ *\n */g, '\n')
    .trim()
}

/** um, uh and friends, with the comma that was only there to frame them. */
function removeFillerWords(text: string): string {
  return text.replace(
    /(,\s*)?(?<![\w'-])(?:um+|uh+|uhm+|erm+|er)(?![\w'-])(\s*,)?/gi,
    (_m, lead?: string, trail?: string) => (lead && trail ? ',' : '')
  )
}

/** "you know", "like" and "I mean" when they are set off by commas, so they are plainly filler. */
function removeFillerPhrases(text: string): string {
  return text
    .replace(/,\s*(?:you know|like|I mean)\s*,/gi, ',')
    .replace(/(^|[.!?]\s+)you know,\s*/gi, '$1')
    .replace(/,\s*you know(?=[.!?]|$)/gi, '')
}

/* ---- self-corrections ---- */

const NUMBER_WORD =
  /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half)$/i

function isNumberToken(token: string): boolean {
  return /^\d[\d:.,]*$/.test(token) || NUMBER_WORD.test(token)
}

function isNameToken(token: string): boolean {
  return /^[A-Z][a-z]+$/.test(token)
}

/** Words that start a spoken correction: "no, I mean ...", ", I mean ...", ", make that ...". */
const CORRECTION_CUE =
  /(?:,\s*)?(?:\b(?:no|sorry|wait|oops)\b[,.]?\s+)+(?:I mean|I meant|make that|rather)\s+|,\s*(?:I mean|I meant|make that)\s+/i

/**
 * "meet at three, no, I mean four" becomes "meet at four"; "send it to John, I mean
 * Jane" becomes "send it to Jane". Only a number replacing a number, or a name
 * replacing a name, is applied. Anything else is left exactly as spoken.
 */
function applySpokenCorrections(text: string): string {
  const cue = new RegExp(CORRECTION_CUE.source, 'gi')
  let out = text
  let from = 0
  for (let guard = 0; guard < 8; guard++) {
    cue.lastIndex = from
    const match = cue.exec(out)
    if (!match) break
    const merged = mergeCorrection(
      out.slice(0, match.index),
      out.slice(match.index + match[0].length)
    )
    if (merged === null) {
      // Not a correction we can apply safely: step over this cue so later ones still work.
      from = match.index + match[0].length
      continue
    }
    out = merged
    from = 0
  }
  return out
}

const stripPunctuation = (token: string): string => token.replace(/^[^\w]+|[^\w]+$/g, '')

function mergeCorrection(left: string, right: string): string | null {
  const leftTokens = left.trimEnd().split(/\s+/).filter(Boolean)
  const rightTokens = [...right.matchAll(/\S+/g)].slice(0, 3)
  if (leftTokens.length === 0 || rightTokens.length === 0) return null
  // The replacement is the leading run of one kind, and the same kind must end the left side.
  for (const isKind of [isNumberToken, isNameToken]) {
    const replacement: RegExpMatchArray[] = []
    for (const token of rightTokens) {
      if (!isKind(stripPunctuation(token[0]))) break
      replacement.push(token)
      if (/[.,;:!?]$/.test(token[0])) break
    }
    if (replacement.length === 0) continue
    let removed = 0
    while (
      removed < leftTokens.length &&
      removed < replacement.length &&
      isKind(stripPunctuation(leftTokens[leftTokens.length - 1 - removed]))
    ) {
      removed++
    }
    if (removed === 0) continue
    const keep = leftTokens.slice(0, leftTokens.length - removed).join(' ')
    const lastToken = replacement[replacement.length - 1]
    const end = (lastToken.index ?? 0) + lastToken[0].length
    const spoken = right.slice(replacement[0].index ?? 0, end)
    return `${keep}${keep ? ' ' : ''}${spoken}${right.slice(end)}`
  }
  return null
}

/** "send it to Bob, scratch that, send it to Alice": drop the sentence before the cue. */
function applyScratchThat(text: string): string {
  const cue = /,?\s*\b(?:scratch that|ignore that|disregard that)\b[,.]?\s*/i
  let out = text
  for (let guard = 0; guard < 4; guard++) {
    const match = cue.exec(out)
    if (!match) break
    const left = out.slice(0, match.index)
    const right = out.slice(match.index + match[0].length)
    if (!right.trim()) break // nothing follows: leave it, the speaker may be quoting
    const boundary = Math.max(
      left.lastIndexOf('. '),
      left.lastIndexOf('! '),
      left.lastIndexOf('? ')
    )
    out = (boundary >= 0 ? left.slice(0, boundary + 2) : '') + right
  }
  return out
}

/* ---- stutters and repeats ---- */

/** Words that are legitimately said twice. */
const LEGIT_REPEATS = new Set([
  'had',
  'that',
  'very',
  'no',
  'bye',
  'so',
  'really',
  'more',
  'ha',
  'hey',
  'yes',
  'long',
  'many',
  'such',
  'well',
  'knock',
  'boo',
  'now',
  'yeah',
  'okay',
  'ok'
])

function collapseRepeats(text: string): string {
  return (
    text
      // "wh- what" -> "what"
      .replace(/\b(\w+)-\s+(?=\1)/gi, '')
      // "I think I think we" -> "I think we"
      .replace(/\b((?:[A-Za-z']+\s+){1,2}[A-Za-z']+)\s+\1\b/gi, (m, phrase: string) =>
        phrase.split(/\s+/).every((w) => LEGIT_REPEATS.has(w.toLowerCase())) ? m : phrase
      )
      // "the the" -> "the", "I, I" -> "I"
      .replace(/\b([A-Za-z']+)(?:(?:,\s*|\s+)\1\b)+/gi, (m, word: string) => {
        if (LEGIT_REPEATS.has(word.toLowerCase())) return m
        if (m.includes(',') && word.length > 3) return m
        return word
      })
  )
}

/* ---- spoken lists ---- */

const ORDINALS: Record<string, number> = {
  first: 1,
  firstly: 1,
  second: 2,
  secondly: 2,
  third: 3,
  thirdly: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6
}
const CARDINALS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

interface Marker {
  index: number
  rest: string
  terminal: boolean
}

function marker(sentence: string): Marker | null {
  const ordinal =
    /^(first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth|fifth|sixth)\b[,:]?\s+(\S[\s\S]*)$/i.exec(
      sentence
    )
  if (ordinal)
    return { index: ORDINALS[ordinal[1].toLowerCase()], rest: ordinal[2], terminal: false }
  // A bare number word needs its comma or colon, so "One day I went" is not a list.
  const cardinal = /^(one|two|three|four|five|six|seven|eight|nine|ten)\b[,:]\s+(\S[\s\S]*)$/i.exec(
    sentence
  )
  if (cardinal)
    return { index: CARDINALS[cardinal[1].toLowerCase()], rest: cardinal[2], terminal: false }
  const digit = /^(\d{1,2})[.)]\s+(\S[\s\S]*)$/.exec(sentence)
  if (digit) return { index: Number(digit[1]), rest: digit[2], terminal: false }
  const last = /^(finally|lastly|last)\b[,:]?\s+(\S[\s\S]*)$/i.exec(sentence)
  if (last) return { index: -1, rest: last[2], terminal: true }
  return null
}

/** "first, milk. second, eggs. third, bread." -> a lead-in line and "- Milk" lines. */
function spokenListToBullets(text: string): string {
  const sentences = text.split(/(?<=[.!?:])\s+/).filter(Boolean)
  const found = sentences.map(marker)
  // The run of consecutive markers 1, 2, 3 ... that starts the list.
  const start = found.findIndex((m) => m !== null && m.index === 1)
  if (start < 0) return text
  const items: string[] = []
  let next = 1
  let end = start
  for (let i = start; i < sentences.length; i++) {
    const m = found[i]
    if (!m) break
    if (m.terminal) {
      if (items.length < 2) break
    } else if (m.index !== next) {
      break
    }
    items.push(m.rest.replace(/[.]+$/, '').trim())
    next++
    end = i
    if (m.terminal) break
  }
  if (items.length < 2) return text
  const lead = sentences.slice(0, start).join(' ')
  const trailing = sentences.slice(end + 1).join(' ')
  const bullets = items.map((item) => `- ${item.charAt(0).toUpperCase()}${item.slice(1)}`)
  const leadLine = lead ? `${lead.replace(/[.:]+$/, '')}:` : ''
  return [leadLine, bullets.join('\n'), trailing ? `\n${trailing}` : '']
    .filter((part) => part !== '')
    .join('\n')
}

/* ---- capitalisation and punctuation ---- */

/** After these, a full stop does not end a sentence. */
const ABBREVIATIONS = /(?:\be\.g|\bi\.e|\bvs|\betc|\bapprox|\bno|\bfig)\.$/i

/**
 * Capital letters at sentence starts, "I", and a final full stop. English only.
 * URLs, e-mail addresses, file names and code identifiers are left exactly as
 * they were spoken. Bullet lines are capitalised but never given a full stop.
 */
export function normalizeCaseAndPunctuation(text: string): string {
  const { text: safe, restore } = protectTokens(text)
  const lines = safe.split('\n').map((line) => {
    const bullet = /^(- )(.*)$/.exec(line)
    const body = bullet ? bullet[2] : line
    let out = body.replace(/\bi\b(?!\.[a-z])(?=['’]|\s|$|[,.!?;:])/g, 'I')
    out = out.replace(
      /^([\s"'“(]*)([a-z])/,
      (_m, lead: string, c: string) => lead + c.toUpperCase()
    )
    out = out.replace(/([.!?]["')”]*\s+)([a-z])/g, (m, gap: string, c: string, offset: number) => {
      const before = out.slice(0, offset + 1)
      return ABBREVIATIONS.test(before) || before.endsWith('..') ? m : gap + c.toUpperCase()
    })
    return bullet ? bullet[1] + out : out
  })
  let joined = lines.join('\n')
  const last = lines[lines.length - 1] ?? ''
  const endsWithToken = new RegExp(`${CLOSE}$`).test(joined.trimEnd())
  if (!last.startsWith('- ') && !endsWithToken) {
    joined = joined.replace(/[,;]\s*$/, '')
    if (/[\p{L}\p{N})"'”]$/u.test(joined.trimEnd())) joined = `${joined.trimEnd()}.`
  }
  return restore(joined)
}

/**
 * The Light tidy-up. Pure and instant. Non-English text, and anything empty,
 * comes back with only its whitespace normalised.
 */
export function tidyLight(input: string): string {
  const collapsed = input.replace(/[ \t]+/g, ' ').trim()
  if (!collapsed || !looksEnglish(collapsed)) return collapsed
  const { text: safe, restore } = protectTokens(collapsed)
  let text = safe
  text = removeFillerWords(text)
  text = removeFillerPhrases(text)
  text = applySpokenCorrections(text)
  text = applyScratchThat(text)
  text = collapseRepeats(text)
  text = tidySpacing(text)
  text = spokenListToBullets(text)
  text = restore(text).trim()
  return text ? normalizeCaseAndPunctuation(text) : ''
}
