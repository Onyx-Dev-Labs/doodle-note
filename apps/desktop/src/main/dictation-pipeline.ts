/**
 * What happens to a finished dictation before it is typed: tidy-up, then the
 * style for the focused app, then an optional auto-applied transform. The plan
 * is decided once, from the settings and the focused app, when the session ends.
 * The deterministic steps are instant and run in place; the model steps (a Full
 * tidy-up, a transform) run through an injected runner, so the whole flow can be
 * tested with a stub model. Every model step falls back to the text before it.
 */
import type { DictationSettings, ModelAvailability, TidyLevel } from '../shared/dictation-api'
import {
  applyStyle,
  categoryForApp,
  type StyleCategory,
  type StyleTone
} from '../shared/dictation-style'
import { applyDictionary, type DictionaryEntry } from '../shared/dictation-dictionary'
import { tidyLight } from '../shared/dictation-tidy'
import type { TransformDef } from '../shared/dictation-transforms'
import {
  MAX_CLEANUP_CHARS,
  buildCleanupRequest,
  buildTransformRequest,
  validateCleanup,
  validateTransform,
  type CleanupRequest
} from './dictation-cleanup'

/** What the notes layer reports it can run. */
export interface ModelOptions {
  localModelLabel: string | null
  byok: { provider: string; model: string; hasKey: boolean } | null
}

export type ModelEngine = 'local' | 'byok'

export interface ResolvedModel extends ModelAvailability {
  /** Which engine a model step would use; null when none can run. */
  engine: ModelEngine | null
}

/**
 * The model a Full tidy-up or a transform would use: the notes model on this Mac
 * if one is installed, otherwise the user's provider once they have allowed
 * sending text to that provider and model. A user who chose the provider
 * explicitly before (cleanupMode byok) keeps it.
 */
export function resolveModel(
  options: ModelOptions,
  settings: Pick<DictationSettings, 'cleanupMode' | 'byokConsent'>
): ResolvedModel {
  const byok = options.byok
  const consented =
    byok !== null &&
    byok.hasKey &&
    settings.byokConsent?.provider === byok.provider &&
    settings.byokConsent?.model === byok.model
  const local = options.localModelLabel
  if (settings.cleanupMode === 'byok' && consented && byok) {
    return { path: 'byok', label: byok.provider, engine: 'byok' }
  }
  if (local) return { path: 'local', label: local, engine: 'local' }
  if (consented && byok) return { path: 'byok', label: byok.provider, engine: 'byok' }
  if (byok?.hasKey) return { path: 'needs-consent', label: byok.provider, engine: null }
  return { path: 'none', label: null, engine: null }
}

export interface DictationPlan {
  category: StyleCategory
  tone: StyleTone
  /** What will actually run: Full becomes Light when no model can run. */
  tidy: TidyLevel
  engine: ModelEngine | null
  /** The auto-applied transform, only when a model can run it. */
  transform: TransformDef | null
  /** Model calls this plan makes. Zero means everything is instant. */
  steps: number
  /** The user's dictionary, applied once to the finished text. */
  dictionary: DictionaryEntry[]
}

export function planDictation(
  settings: DictationSettings,
  options: ModelOptions,
  bundleId: string | null | undefined
): DictationPlan {
  const model = resolveModel(options, settings)
  const category = categoryForApp(bundleId, settings.styleApps)
  const tidy: TidyLevel =
    settings.tidyLevel === 'full' && !model.engine ? 'light' : settings.tidyLevel
  const wanted = settings.transforms.enabled && settings.transforms.autoApply
  const transform =
    wanted && model.engine
      ? (settings.transforms.items.find((item) => item.id === settings.transforms.autoApplyId) ??
        null)
      : null
  return {
    category,
    tone: settings.styles[category],
    tidy,
    engine: model.engine,
    transform,
    steps: (tidy === 'full' ? 1 : 0) + (transform ? 1 : 0),
    dictionary: settings.dictionary
  }
}

/**
 * Off keeps the raw words and skips styles; Light and Full apply the style. The
 * dictionary always applies, and last, so a style can never change how a word in
 * it is written and one entry's output is never matched by another.
 */
function styled(text: string, plan: DictationPlan): string {
  return applyDictionary(plan.tidy === 'off' ? text : applyStyle(text, plan.tone), plan.dictionary)
}

/** The text for a plan with no model step: instant and deterministic. */
export function deterministicText(raw: string, plan: DictationPlan): string {
  const tidied = plan.tidy === 'light' ? tidyLight(raw) : raw
  return styled(tidied, plan)
}

/**
 * What to insert if the model work fails or times out: the raw words with the
 * style, or the Light result when Light is what the plan asked for.
 */
export function fallbackText(raw: string, plan: DictationPlan): string {
  return plan.tidy === 'full' ? styled(raw, plan) : deterministicText(raw, plan)
}

export interface TransformChange {
  name: string
  before: string
  after: string
}

export interface PipelineOutcome {
  text: string
  /** Set when a step was skipped or doubted, so the pill can say so. */
  note: string | null
  /** The auto-applied transform's before and after, for View and Undo; null if none ran. */
  change: TransformChange | null
  timings: { tidyMs: number | null; transformMs: number | null }
}

export type ModelRunner = (request: CleanupRequest, signal: AbortSignal) => Promise<string>

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message.slice(0, 120).trim() : 'The model failed'
  return /[.!?]$/.test(message) ? message : `${message}.`
}

/**
 * Run the model steps of a plan. A failing, doubtful or oversized step keeps the
 * text it was given and sets the note; an abort (cancel, timeout) is rethrown.
 */
export async function runModelSteps(
  raw: string,
  plan: DictationPlan,
  run: ModelRunner,
  signal: AbortSignal,
  now: () => number = Date.now
): Promise<PipelineOutcome> {
  const notes: string[] = []
  const timings: PipelineOutcome['timings'] = { tidyMs: null, transformMs: null }
  let text: string

  if (plan.tidy === 'full') {
    if (raw.length > MAX_CLEANUP_CHARS) {
      notes.push('Too long to tidy with the model; the raw transcript was used.')
      text = fallbackText(raw, plan)
    } else {
      const started = now()
      try {
        const output = await run(buildCleanupRequest(raw), signal)
        const verdict = validateCleanup(raw, output)
        if (verdict.ok) {
          text = styled(verdict.text, plan)
        } else {
          notes.push(`${verdict.reason} The raw transcript was used.`)
          text = fallbackText(raw, plan)
        }
      } catch (error) {
        if (signal.aborted) throw error
        notes.push(`${describe(error)} The raw transcript was used.`)
        text = fallbackText(raw, plan)
      }
      timings.tidyMs = now() - started
    }
  } else {
    text = deterministicText(raw, plan)
  }

  let change: TransformChange | null = null
  if (plan.transform) {
    if (text.length > MAX_CLEANUP_CHARS) {
      notes.push(`Too long for ${plan.transform.name}; it was skipped.`)
    } else {
      const started = now()
      try {
        const output = await run(buildTransformRequest(plan.transform, text), signal)
        const verdict = validateTransform(text, output, plan.transform.keepFacts)
        if (verdict.ok) {
          // View and Undo compare against what is typed, so the dictionary is applied first.
          const after = applyDictionary(verdict.text, plan.dictionary)
          if (after !== text) change = { name: plan.transform.name, before: text, after }
          text = after
        } else {
          notes.push(`${plan.transform.name}: ${verdict.reason} The text before it was used.`)
        }
      } catch (error) {
        if (signal.aborted) throw error
        notes.push(`${plan.transform.name}: ${describe(error)} The text before it was used.`)
      }
      timings.transformMs = now() - started
    }
  }
  return { text, note: notes.length > 0 ? notes.join(' ') : null, change, timings }
}
