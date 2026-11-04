import type { GlobalAskBudget } from './global-ask-prompt'

/** Recipes retain their entire declared input; reject rather than silently truncate it. */
export function assertRequestFits(system: string, user: string, budget: GlobalAskBudget): void {
  const { contextWindowTokens, outputReserveTokens, safetyMarginTokens } = budget
  const input = budget.countInputTokens(system, user)
  if (
    ![contextWindowTokens, outputReserveTokens, safetyMarginTokens, input].every(Number.isSafeInteger) ||
    contextWindowTokens <= 0 || outputReserveTokens <= 0 || safetyMarginTokens < 0 || input < 0
  ) throw new Error('The selected model has no supported request budget. Choose another model.')
  if (input + outputReserveTokens + safetyMarginTokens > contextWindowTokens)
    throw new Error('This fetch and its selected meeting inputs exceed the model context. Select fewer inputs, shorten the instructions, or choose a larger supported model. Nothing was generated.')
}
