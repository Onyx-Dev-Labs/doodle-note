export type GenerationPhase = 'preparing' | 'condensing' | 'writing'
export type GenerationErrorCode = 'canceled' | 'timeout' | 'output-limit'

export class GenerationError extends Error {
  constructor(
    readonly code: GenerationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'GenerationError'
  }
}

/** Includes prefill and decoding. These are safety ceilings, not completion estimates. */
export const GENERATION_LIMITS = {
  preparing: { timeoutMs: 120_000, maxTokens: 0 },
  condensing: { timeoutMs: 180_000, maxTokens: 2048 },
  writing: { timeoutMs: 300_000, maxTokens: 4096 }
} as const

/** Abort the actual producer and await its finally/cleanup; never abandon native work. */
export async function withGenerationDeadline<T>(
  parent: AbortSignal | undefined,
  phase: GenerationPhase,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = GENERATION_LIMITS[phase].timeoutMs
): Promise<T> {
  parent?.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void => controller.abort(parent?.reason)
  parent?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () =>
      controller.abort(
        new GenerationError(
          'timeout',
          `Notes ${phase} timed out. Your existing notes are unchanged. Retry or choose another local model in Settings.`
        )
      ),
    timeoutMs
  )
  try {
    const result = await work(controller.signal)
    controller.signal.throwIfAborted()
    return result
  } catch (error) {
    controller.signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
  }
}

export function requireCompleteOutput(stopReason: string, phase: GenerationPhase): void {
  if (stopReason === 'maxTokens' || stopReason === 'length') {
    throw new GenerationError(
      'output-limit',
      `Notes ${phase} reached its output limit. No incomplete notes were saved. Retry or choose another local model in Settings.`
    )
  }
  if (stopReason === 'abort') throw new GenerationError('canceled', 'Notes generation canceled.')
}
