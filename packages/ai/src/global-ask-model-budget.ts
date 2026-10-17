import type { CloudProviderId } from './cloud-engine'
import {
  GlobalAskBudgetError,
  utf8TokenUpperBound,
  type GlobalAskBudget
} from './global-ask-prompt'

/** Verified provider limits, not inference from a model-name prefix. See docs/global-ask-budget.md. */
const HOSTED_WINDOWS: Partial<Record<CloudProviderId, Record<string, number>>> = {
  anthropic: { 'claude-sonnet-5': 1_000_000 },
  openai: { 'gpt-5': 400_000 },
  grok: { 'grok-4.6': 500_000 },
  gemini: { 'gemini-3.8-flash': 1_048_576 }
}

export function hostedGlobalAskBudget(provider: CloudProviderId, model: string): GlobalAskBudget {
  const contextWindowTokens = HOSTED_WINDOWS[provider]?.[model]
  if (!contextWindowTokens) {
    throw new GlobalAskBudgetError(
      'unsupported-model-budget',
      `Ask cannot verify the context limit for ${model}. Select this provider's default model or an on-device model in Settings.`
    )
  }
  return {
    contextWindowTokens,
    outputReserveTokens: 4096,
    // Server-side role delimiters and special tokens are not exposed by these
    // SDKs. Reserve 1024 in addition to one token per UTF-8 byte of input.
    safetyMarginTokens: 1024,
    accounting: 'utf8-upper-bound',
    countInputTokens: (system, user) => utf8TokenUpperBound(system) + utf8TokenUpperBound(user)
  }
}

/** Audited two-message template from ollama/ollama template/llama3-instruct.gotmpl.
 * Custom Go templates can repeat input arbitrarily; metadata length alone is
 * not a bound on their expansion. Fail closed for unrecognized templates.
 */
export const OLLAMA_GLOBAL_ASK_TEMPLATE = `{{- range .Messages }}<|start_header_id|>{{ .Role }}<|end_header_id|>

{{ .Content }}<|eot_id|>
{{- end }}<|start_header_id|>assistant<|end_header_id|>`

/**
 * Ollama's OpenAI endpoint cannot set num_ctx. Require an explicit Modelfile
 * setting rather than confusing the model's trained maximum with its runtime
 * allocation. Read only local metadata; never send meeting content here.
 */
export async function ollamaGlobalAskBudget(model: string): Promise<GlobalAskBudget> {
  const response = await fetch('http://localhost:11434/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error'
  })
  if (!response.ok)
    throw new Error(
      'Could not read the local Ollama model limits. Check Ollama or select an on-device model in Settings.'
    )
  const info = (await response.json()) as {
    parameters?: string
    template?: string
    model_info?: Record<string, unknown>
    messages?: unknown
    remote_model?: string
    remote_host?: string
  }
  // Ollama prepends Modelfile MESSAGE entries even when our request begins
  // with an explicit system message. The audited template does not bound
  // those hidden inputs. An absent field or an empty array adds no messages.
  if (
    Object.hasOwn(info, 'messages') &&
    (!Array.isArray(info.messages) || info.messages.length > 0)
  ) {
    throw new GlobalAskBudgetError(
      'unsupported-model-budget',
      "Ask cannot safely budget this Ollama model's embedded messages. Use a model without Modelfile MESSAGE entries, or select an on-device model in Settings."
    )
  }
  const configured = Number(info.parameters?.match(/^num_ctx\s+(\d+)\s*$/m)?.[1])
  const architecture = info.model_info?.['general.architecture']
  const trained =
    typeof architecture === 'string'
      ? info.model_info?.[`${architecture}.context_length`]
      : undefined
  if (
    info.remote_model ||
    info.remote_host ||
    !Number.isSafeInteger(configured) ||
    configured <= 0 ||
    typeof trained !== 'number' ||
    !Number.isSafeInteger(trained) ||
    trained <= 0 ||
    architecture !== 'llama' ||
    typeof info.template !== 'string' ||
    info.template.trim() !== OLLAMA_GLOBAL_ASK_TEMPLATE.trim()
  ) {
    throw new GlobalAskBudgetError(
      'unsupported-model-budget',
      'Ask needs a local Llama model with an explicit num_ctx setting and the supported llama3-instruct chat template. Configure its Modelfile, or select an on-device model in Settings.'
    )
  }
  return {
    contextWindowTokens: Math.min(configured, trained),
    outputReserveTokens: Math.min(4096, Math.floor(Math.min(configured, trained) / 4)),
    safetyMarginTokens: 1024 + 2 * utf8TokenUpperBound(info.template),
    accounting: 'utf8-upper-bound',
    countInputTokens: (system, user) => utf8TokenUpperBound(system) + utf8TokenUpperBound(user)
  }
}
