/**
 * Styles: how dictated text is cased and punctuated for the app it is going
 * into. Deterministic, no model. A style is a tone per app category, and the
 * category comes from the focused app's bundle id. English only: other
 * languages pass through untouched.
 */
import {
  looksEnglish,
  normalizeCaseAndPunctuation,
  protectTokens,
  tidyLight
} from './dictation-tidy'

export const STYLE_CATEGORIES = ['personal', 'work', 'email', 'other'] as const
export type StyleCategory = (typeof STYLE_CATEGORIES)[number]

export const STYLE_CATEGORY_LABELS: Record<StyleCategory, string> = {
  personal: 'Personal messages',
  work: 'Work messages',
  email: 'Email',
  other: 'Everything else'
}

/** proper: capitals and full punctuation. relaxed: capitals, no closing full stop. lowercase: quick texting. */
export const STYLE_TONES = ['proper', 'relaxed', 'lowercase'] as const
export type StyleTone = (typeof STYLE_TONES)[number]

export const STYLE_TONE_LABELS: Record<StyleTone, string> = {
  proper: 'Proper',
  relaxed: 'Relaxed',
  lowercase: 'Lowercase quick'
}

export const STYLE_TONE_HINTS: Record<StyleTone, string> = {
  proper: 'Capitals and full punctuation.',
  relaxed: 'Capitals, but no full stop at the end. Question and exclamation marks stay.',
  lowercase: 'No capitals except I and acronyms, and no full stop at the end.'
}

export type StyleChoices = Record<StyleCategory, StyleTone>

export const DEFAULT_STYLES: StyleChoices = {
  personal: 'relaxed',
  work: 'proper',
  email: 'proper',
  other: 'proper'
}

/** User additions: bundle ids placed in a category, which win over the built-in list. */
export type StyleApps = Record<StyleCategory, string[]>

export const EMPTY_STYLE_APPS: StyleApps = { personal: [], work: [], email: [], other: [] }

/**
 * Apps known by bundle id. Mail in a browser (Gmail and the like) cannot be
 * told from any other web page, so browsers stay in "Everything else" unless
 * the user moves them.
 */
export const BUILTIN_STYLE_APPS: Record<Exclude<StyleCategory, 'other'>, string[]> = {
  personal: [
    'com.apple.MobileSMS',
    'net.whatsapp.WhatsApp',
    'ru.keepcoder.Telegram',
    'org.telegram.desktop',
    'com.hnc.Discord',
    'org.whispersystems.signal-desktop',
    'com.facebook.archon.developerID',
    'com.facebook.Messenger'
  ],
  work: [
    'com.tinyspeck.slackmacgap',
    'com.microsoft.teams2',
    'com.microsoft.teams',
    'Cisco-Systems.Spark',
    'us.zoom.xos',
    'com.linear'
  ],
  email: [
    'com.apple.mail',
    'com.microsoft.Outlook',
    'com.readdle.smartemail-Mac',
    'com.freron.MailMate',
    'it.bloop.airmail2',
    'com.superhuman.electron'
  ]
}

/**
 * The same categories on Windows, by executable name (the Windows helper reports the
 * focused program's file name, in lower case, where macOS reports a bundle id). The
 * two vocabularies never overlap: a Windows name always ends in ".exe".
 */
export const BUILTIN_STYLE_APPS_WINDOWS: Record<Exclude<StyleCategory, 'other'>, string[]> = {
  personal: [
    'whatsapp.exe',
    'whatsapp.root.exe',
    'telegram.exe',
    'discord.exe',
    'signal.exe',
    'messenger.exe'
  ],
  work: [
    'slack.exe',
    'ms-teams.exe',
    'teams.exe',
    'ciscocollabhost.exe',
    'webex.exe',
    'zoom.exe',
    'linear.exe'
  ],
  email: [
    'outlook.exe',
    'olk.exe',
    'hxoutlook.exe',
    'thunderbird.exe',
    'mailbird.exe',
    'superhuman.exe'
  ]
}

/** The built-in lists the settings page shows on a platform. */
export function builtinStyleApps(
  platform: 'darwin' | 'win32' = 'darwin'
): Record<Exclude<StyleCategory, 'other'>, string[]> {
  return platform === 'win32' ? BUILTIN_STYLE_APPS_WINDOWS : BUILTIN_STYLE_APPS
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
}

/** The category for a focused app: the user's own lists first, then the built-in ones. */
export function categoryForApp(
  bundleId: string | null | undefined,
  apps: StyleApps
): StyleCategory {
  if (!bundleId) return 'other'
  const wanted = normalizeId(bundleId)
  for (const category of STYLE_CATEGORIES) {
    if (apps[category].some((id) => normalizeId(id) === wanted)) return category
  }
  for (const category of ['personal', 'work', 'email'] as const) {
    if (BUILTIN_STYLE_APPS[category].some((id) => normalizeId(id) === wanted)) return category
  }
  for (const category of ['personal', 'work', 'email'] as const) {
    if (BUILTIN_STYLE_APPS_WINDOWS[category].some((id) => normalizeId(id) === wanted))
      return category
  }
  return 'other'
}

/** The apps a category lists, built-in first, for the settings page. */
export function appsInCategory(
  category: StyleCategory,
  apps: StyleApps,
  platform: 'darwin' | 'win32' = 'darwin'
): Array<{ bundleId: string; builtin: boolean }> {
  const mine = apps[category]
  const builtin =
    category === 'other'
      ? []
      : builtinStyleApps(platform)[category].filter(
          // An app the user moved elsewhere is no longer listed here.
          (id) => categoryForApp(id, apps) === category
        )
  return [
    ...builtin.map((bundleId) => ({ bundleId, builtin: true })),
    ...mine.filter((id) => !builtin.includes(id)).map((bundleId) => ({ bundleId, builtin: false }))
  ]
}

/** Put an app in a category, taking it out of any other of the user's lists. */
export function moveApp(apps: StyleApps, bundleId: string, to: StyleCategory): StyleApps {
  const id = bundleId.trim()
  if (!id) return apps
  const out: StyleApps = { personal: [], work: [], email: [], other: [] }
  for (const category of STYLE_CATEGORIES) {
    out[category] = apps[category].filter((existing) => normalizeId(existing) !== normalizeId(id))
  }
  out[to] = [...out[to], id]
  return out
}

export function removeApp(apps: StyleApps, bundleId: string): StyleApps {
  const out: StyleApps = { personal: [], work: [], email: [], other: [] }
  for (const category of STYLE_CATEGORIES) {
    out[category] = apps[category].filter(
      (existing) => normalizeId(existing) !== normalizeId(bundleId)
    )
  }
  return out
}

/* ---- applying a tone ---- */

/** Take the closing full stop off the last line of prose; ? and ! stay. */
function dropClosingFullStop(text: string): string {
  const lines = text.split('\n')
  const last = lines[lines.length - 1] ?? ''
  if (last.startsWith('- ')) return text
  lines[lines.length - 1] = last.replace(/(?<!\.)\.$/, '')
  return lines.join('\n')
}

/** Lower-case a word unless it is an acronym, has capitals inside, or the user told us its case. */
function lowerWord(word: string, known: ReadonlyMap<string, string>): string {
  const canonical = known.get(word.toLowerCase())
  if (canonical) return canonical
  if (/^I(?:['’][A-Za-z]+)?$/.test(word)) return word
  if (/^[A-Z0-9]{2,}s?$/.test(word) && /[A-Z]/.test(word)) return word
  if (/^[a-z]+[A-Z]/.test(word) || /^[A-Z][a-z0-9]*[A-Z]/.test(word)) return word
  return word.toLowerCase()
}

/**
 * Apply a tone to English text. The result of Light tidy-up (or the raw words)
 * goes in; other languages come back unchanged.
 *
 * `knownTerms` is where a personal dictionary would plug in: names and terms the
 * user typed keep their capitals under Lowercase quick. There is no dictionary
 * yet, so callers pass nothing.
 */
export function applyStyle(
  text: string,
  tone: StyleTone,
  options: { knownTerms?: readonly string[] } = {}
): string {
  if (!text.trim() || !looksEnglish(text)) return text
  if (tone === 'proper') return normalizeCaseAndPunctuation(text)
  if (tone === 'relaxed') return dropClosingFullStop(normalizeCaseAndPunctuation(text))
  // Lowercase quick: start from the proper form so "i" and sentence ends are settled first.
  const proper = normalizeCaseAndPunctuation(text)
  const known = new Map((options.knownTerms ?? []).map((term) => [term.toLowerCase(), term]))
  const { text: safe, restore } = protectTokens(proper)
  const lowered = safe.replace(/[A-Za-z][A-Za-z0-9'’]*/g, (word) => lowerWord(word, known))
  return dropClosingFullStop(restore(lowered))
}

/* ---- the sample shown on each card ---- */

/** What someone might say, before any tidy-up. */
export const STYLE_SAMPLE_INPUT =
  'um hey are you free tomorrow, i was thinking we could grab lunch at noon'

/** The sample as it would be typed with this tone: Light tidy-up, then the style. */
export function styleSample(tone: StyleTone): string {
  return applyStyle(tidyLight(STYLE_SAMPLE_INPUT), tone)
}
