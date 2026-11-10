/**
 * Transforms: named rewrite prompts the user can run on text with a model. This
 * module is only data and pure helpers (the built-in prompts, settings
 * validation, shortcut collisions, the word diff behind "View changes"). Running
 * one, and checking what the model returned, happens in the main process.
 */

export interface TransformDef {
  /** Stable key: lower-case letters, digits and dashes. */
  id: string
  name: string
  /** The instruction the model follows. Our own text for built-ins, the user's for their own. */
  prompt: string
  /** Optional global shortcut (an Electron accelerator); empty = none. */
  hotkey: string
  /**
   * The result must keep every number, name and negation of the input (Polish).
   * Rewrites that legitimately reshape the text, such as a summary, leave it off.
   */
  keepFacts: boolean
}

export interface TransformSettings {
  /** Opt-in: transforms are off until the user turns them on. */
  enabled: boolean
  /** Run one transform after every dictation, after tidy-up and Style. */
  autoApply: boolean
  autoApplyId: string | null
  items: TransformDef[]
}

export const MAX_TRANSFORMS = 20
export const MAX_TRANSFORM_NAME = 40
export const MAX_TRANSFORM_PROMPT = 2_000

export const BUILTIN_TRANSFORMS: readonly TransformDef[] = [
  {
    id: 'polish',
    name: 'Polish',
    prompt:
      "Rewrite the text so it reads clearly and tightly. Fix grammar and awkward phrasing, cut padding and repetition, and keep the same meaning, facts, names and numbers. Keep the writer's voice and language. Add nothing that is not already there.",
    hotkey: '',
    keepFacts: true
  },
  {
    id: 'shorter',
    name: 'Make it shorter',
    prompt:
      "Make the text clearly shorter, roughly half as long where possible. Drop repetition and low-value detail but keep every key fact, decision, name and number. Keep the writer's voice and language.",
    hotkey: '',
    keepFacts: false
  },
  {
    id: 'friendly-email',
    name: 'Friendly email',
    prompt:
      'Turn the text into the body of a short, warm, professional email. Open with a greeting (use "Hi," unless a name appears in the text), keep a friendly and direct tone, and end with a brief sign-off line without a name. Use only the facts in the text: do not invent names, dates, amounts or promises.',
    hotkey: '',
    keepFacts: false
  },
  {
    id: 'bullets',
    name: 'Bullet summary',
    prompt:
      'Summarise the text as a short list of bullet points, one idea per line, each starting with "- ". Keep the important facts, names and numbers. Do not add anything that is not in the text.',
    hotkey: '',
    keepFacts: false
  },
  {
    id: 'ai-prompt',
    name: 'Turn it into a prompt for an AI assistant',
    prompt:
      'Rewrite the text as a clear, well-structured prompt for an AI assistant. State the goal first, then the needed context, then any constraints, then the format the answer should take. Use only details found in the text and do not invent requirements. Output the prompt itself with no preamble.',
    hotkey: '',
    keepFacts: false
  }
]

export const DEFAULT_TRANSFORM_SETTINGS: TransformSettings = {
  enabled: false,
  autoApply: false,
  autoApplyId: null,
  items: BUILTIN_TRANSFORMS.map((item) => ({ ...item }))
}

/** Back to the shipped list; the opt-in and the auto-apply choice are the user's and stay. */
export function resetTransforms(current: TransformSettings): TransformSettings {
  const items = BUILTIN_TRANSFORMS.map((item) => ({ ...item }))
  const stillThere = items.some((item) => item.id === current.autoApplyId)
  return {
    ...current,
    items,
    autoApplyId: stillThere ? current.autoApplyId : null,
    autoApply: stillThere ? current.autoApply : false
  }
}

function normalizeItem(raw: unknown): TransformDef | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return null
  if (!name || name.length > MAX_TRANSFORM_NAME) return null
  if (!prompt || prompt.length > MAX_TRANSFORM_PROMPT) return null
  const hotkey =
    typeof item.hotkey === 'string' && item.hotkey.length <= 64 ? item.hotkey.trim() : ''
  return { id, name, prompt, hotkey, keepFacts: item.keepFacts === true }
}

/** Coerce arbitrary JSON into valid transform settings. A missing list means the shipped one. */
export function normalizeTransformSettings(input: unknown): TransformSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  let items: TransformDef[]
  if (Array.isArray(raw.items)) {
    const seen = new Set<string>()
    items = []
    for (const candidate of raw.items) {
      const item = normalizeItem(candidate)
      if (!item || seen.has(item.id) || items.length >= MAX_TRANSFORMS) continue
      seen.add(item.id)
      items.push(item)
    }
  } else {
    items = BUILTIN_TRANSFORMS.map((item) => ({ ...item }))
  }
  const autoApplyId =
    typeof raw.autoApplyId === 'string' && items.some((item) => item.id === raw.autoApplyId)
      ? raw.autoApplyId
      : null
  return {
    enabled: raw.enabled === true,
    autoApply: raw.autoApply === true && autoApplyId !== null,
    autoApplyId,
    items
  }
}

/** A fresh id for a new transform, from its name. */
export function newTransformId(name: string, existing: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'transform'
  let id = base
  for (let n = 2; existing.includes(id); n++) id = `${base}-${n}`
  return id
}

/* ---- shortcuts ---- */

/**
 * Which entries share a shortcut with another entry (case-insensitively). An empty
 * accelerator never collides. Every one of a clashing group is returned, so none
 * of them fires and each can say why.
 */
export function conflictingShortcuts(
  entries: ReadonlyArray<{ id: string; accelerator: string }>
): Set<string> {
  const owners = new Map<string, string[]>()
  for (const { id, accelerator } of entries) {
    const key = accelerator.trim().toLowerCase()
    if (!key) continue
    owners.set(key, [...(owners.get(key) ?? []), id])
  }
  const clashing = new Set<string>()
  for (const ids of owners.values()) if (ids.length > 1) for (const id of ids) clashing.add(id)
  return clashing
}

/* ---- the word diff behind "View changes" ---- */

export interface DiffSegment {
  op: 'same' | 'add' | 'del'
  text: string
}

/** Beyond this many words the diff is shown as one removal and one addition. */
export const MAX_DIFF_WORDS = 1_500

function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? []
}

/**
 * A word-level diff: the words and spaces of `before` and `after`, grouped into
 * runs that stayed, were removed or were added. Unchanged runs keep their spacing.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ op: 'same', text: before }] : []
  const a = tokens(before)
  const b = tokens(after)
  if (a.length > MAX_DIFF_WORDS || b.length > MAX_DIFF_WORDS) {
    return [
      ...(before ? [{ op: 'del' as const, text: before }] : []),
      ...(after ? [{ op: 'add' as const, text: after }] : [])
    ]
  }
  // Longest common subsequence over tokens.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out: DiffSegment[] = []
  const push = (op: DiffSegment['op'], text: string): void => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('del', a[i++])
    } else {
      push('add', b[j++])
    }
  }
  while (i < a.length) push('del', a[i++])
  while (j < b.length) push('add', b[j++])
  return out
}
