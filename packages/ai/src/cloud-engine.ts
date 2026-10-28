import { assertRequestFits } from './bounded-request'
import { withGenerationDeadline } from './generation-control'
import { hostedGlobalAskBudget, ollamaGlobalAskBudget } from './global-ask-model-budget'
import { requireCompleteOutput } from './generation-control'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { buildAskSystemPrompt, buildAskUserMessage } from './ask-prompt'
import { buildGlobalAskPrompt, type GlobalAskInput } from './global-ask-prompt'
import { generateMeetingNotes } from './map-reduce'
import type {
  GenerationControl,
  AskAnswer,
  AskInput,
  MergeInput,
  MergedNotes,
  NotesEngine,
  NotesProgress
} from './types'

/**
 * The optional BYOK path: same merge, run against the user's own API key.
 * Added in settings AFTER onboarding — the local engine is the default.
 *
 * grok / gemini / ollama speak the OpenAI wire protocol — one client,
 * different base URLs. Ollama runs locally and needs no real key.
 */
export type CloudProviderId = 'anthropic' | 'openai' | 'grok' | 'gemini' | 'ollama'

export interface CloudEngineOptions {
  provider: CloudProviderId
  apiKey: string
  /** Explicit confirmation for this provider/key: no training; Gemini billing enabled. */
  dataPolicyConfirmed?: boolean
  /** Provider model id; falls back to a sensible default per provider. */
  model?: string
}

export const CLOUD_PROVIDER_PRESETS: Record<
  CloudProviderId,
  {
    label: string
    defaultModel: string
    baseURL?: string
    keyOptional?: boolean
  }
> = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-5' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-5' },
  grok: {
    label: 'Grok (xAI)',
    defaultModel: 'grok-4.6',
    baseURL: 'https://api.x.ai/v1'
  },
  gemini: {
    label: 'Google Gemini (paid API)',
    defaultModel: 'gemini-3.8-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai'
  },
  ollama: {
    label: 'Ollama (local)',
    defaultModel: 'llama3.1',
    baseURL: 'http://localhost:11434/v1',
    keyOptional: true
  }
}

export class CloudNotesEngine implements NotesEngine {
  readonly id: string
  readonly label: string
  /** Frontier context windows dwarf the local 16K — condense only marathon
   *  transcripts (~5+ hours of speech). */
  readonly singlePassThresholdChars = 400_000
  private readonly options: CloudEngineOptions

  constructor(options: CloudEngineOptions) {
    this.options = options
    this.id = `cloud:${options.provider}:${options.model?.trim() || CLOUD_PROVIDER_PRESETS[options.provider]?.defaultModel || 'default'}`
    const preset = CLOUD_PROVIDER_PRESETS[options.provider]
    if (!preset)
      throw new Error(
        'This AI provider is retired. Select a supported provider and enter its own API key in Settings.'
      )
    this.label = options.provider === 'ollama' ? preset.label : `${preset.label} (your key)`
  }

  async generateNotes(
    input: MergeInput,
    onToken?: (text: string) => void,
    onProgress?: (progress: NotesProgress) => void,
    control?: GenerationControl
  ): Promise<MergedNotes> {
    return generateMeetingNotes(this, input, onToken, onProgress, control)
  }

  async askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer> {
    return this.runRaw(buildAskSystemPrompt(input.speakers), buildAskUserMessage(input), onToken)
  }

  async askAcrossMeetings(
    input: GlobalAskInput,
    onToken?: (text: string) => void
  ): Promise<AskAnswer> {
    this.assertDataPolicy()
    const model =
      this.options.model?.trim() || CLOUD_PROVIDER_PRESETS[this.options.provider].defaultModel
    const budget =
      this.options.provider === 'ollama'
        ? await ollamaGlobalAskBudget(model)
        : hostedGlobalAskBudget(this.options.provider, model)
    const prompt = buildGlobalAskPrompt(input, budget)
    const result = await this.runRaw(
      prompt.system,
      prompt.user,
      onToken,
      undefined,
      budget.outputReserveTokens
    )
    return { ...result, coverage: prompt.coverage }
  }

  async runBounded(system: string, prompt: string, control?: GenerationControl): Promise<MergedNotes> {
    this.assertDataPolicy()
    return withGenerationDeadline(control?.signal, 'writing', async (signal) => {
      const model = this.options.model?.trim() || CLOUD_PROVIDER_PRESETS[this.options.provider].defaultModel
      const budget = this.options.provider === 'ollama'
        ? await ollamaGlobalAskBudget(model)
        : hostedGlobalAskBudget(this.options.provider, model)
      signal.throwIfAborted()
      assertRequestFits(system, prompt, budget)
      return this.runRaw(system, prompt, undefined, { ...control, signal }, budget.outputReserveTokens)
    })
  }

  async runRaw(
    system: string,
    prompt: string,
    onToken?: (text: string) => void,
    control?: GenerationControl,
    maxOutputTokens?: number
  ): Promise<MergedNotes> {
    this.assertDataPolicy()
    return this.generateRaw(system, prompt, onToken, control, maxOutputTokens)
  }

  private assertDataPolicy(): void {
    if (!Object.hasOwn(CLOUD_PROVIDER_PRESETS, this.options.provider)) {
      throw new Error(
        'This AI provider is retired. Select a supported provider and enter its own API key in Settings.'
      )
    }
    if (this.options.provider !== 'ollama' && this.options.dataPolicyConfirmed !== true) {
      throw new Error(
        'Confirm the AI data-use requirements in Settings before sending meeting content. Gemini requires a billing-enabled API project.'
      )
    }
  }

  private async generateRaw(
    system: string,
    prompt: string,
    onToken?: (text: string) => void,
    control?: GenerationControl,
    maxOutputTokens?: number
  ): Promise<MergedNotes> {
    const started = Date.now()
    const preset = CLOUD_PROVIDER_PRESETS[this.options.provider]
    const modelId = this.options.model?.trim() || preset.defaultModel
    const openai =
      this.options.provider === 'anthropic'
        ? undefined
        : createOpenAI({
            apiKey: this.options.apiKey || 'ollama',
            ...(preset.baseURL ? { baseURL: preset.baseURL } : {})
          })
    const model =
      this.options.provider === 'anthropic'
        ? createAnthropic({ apiKey: this.options.apiKey })(modelId)
        : this.options.provider === 'openai'
          ? openai!(modelId)
          : openai!.chat(modelId)
    control?.signal?.throwIfAborted()
    const { text, finishReason } = await generateText({
      abortSignal: control?.signal,
      model,
      system,
      prompt,
      temperature: 0.3,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(this.options.provider === 'openai'
        ? { providerOptions: { openai: { store: false } } }
        : {})
    })
    control?.signal?.throwIfAborted()
    requireCompleteOutput(finishReason, control?.phase ?? 'writing')
    onToken?.(text)
    return {
      markdown: text.trim(),
      engine: this.id,
      elapsedMs: Date.now() - started
    }
  }
}
