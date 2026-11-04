/**
 * Sizing and choosing for dictation's own use of the local model. Cleanup works
 * on a sentence or a paragraph, not a meeting, so it asks for a small context and
 * a short answer, and runs on the quickest model that is installed.
 */
import type { LocalModelSpec } from '@repo/ai'

/** A generous characters-per-token guess; only used to size a request, never to cut text. */
export const approxTokens = (text: string): number => Math.ceil(text.length / 3)

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

export interface DictationBudget {
  contextSize: number
  maxTokens: number
}

/**
 * Room for the request, the answer and a safety margin, rounded up to 256 tokens.
 * A tidy-up answers with about as many words as it was given; a transform may
 * expand (an email from a few lines), so the answer cap is twice the input plus a
 * margin, never more than 2,048 tokens.
 */
export function dictationBudget(system: string, prompt: string): DictationBudget {
  const input = approxTokens(system) + approxTokens(prompt)
  const maxTokens = clamp(approxTokens(prompt) * 2 + 192, 256, 2048)
  const contextSize = clamp(Math.ceil((input + maxTokens + 256) / 256) * 256, 1024, 8192)
  return { contextSize, maxTokens }
}

/** The quickest of the installed models: the smallest download. Ties keep catalog order. */
export function fastestInstalled<T extends Pick<LocalModelSpec, 'sizeGB'>>(
  installed: readonly T[]
): T | null {
  let best: T | null = null
  for (const spec of installed) if (!best || spec.sizeGB < best.sizeGB) best = spec
  return best
}
