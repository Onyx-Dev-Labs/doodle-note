import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { ASK_SYSTEM_PROMPT, buildAskUserMessage } from './ask-prompt'
import { buildMergeUserMessage, MERGE_SYSTEM_PROMPT } from './prompt'
import type { AskAnswer, AskInput, MergeInput, MergedNotes, NotesEngine } from './types'

/**
 * The optional BYOK path: same merge, run against the user's own API key.
 * Added in settings AFTER onboarding — the local engine is the default.
 */
export interface CloudEngineOptions {
  provider: 'anthropic' | 'openai'
  apiKey: string
  /** Provider model id; defaults to a sensible current model for anthropic. */
  model?: string
}

export class CloudNotesEngine implements NotesEngine {
  readonly id: string
  readonly label: string
  private readonly options: CloudEngineOptions

  constructor(options: CloudEngineOptions) {
    this.options = options
    this.id = `cloud:${options.provider}:${options.model ?? 'default'}`
    this.label = options.provider === 'anthropic' ? 'Anthropic (your key)' : 'OpenAI (your key)'
  }

  async generateNotes(input: MergeInput, onToken?: (text: string) => void): Promise<MergedNotes> {
    return this.runPrompt(MERGE_SYSTEM_PROMPT, buildMergeUserMessage(input), onToken)
  }

  async askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer> {
    return this.runPrompt(ASK_SYSTEM_PROMPT, buildAskUserMessage(input), onToken)
  }

  private async runPrompt(
    system: string,
    prompt: string,
    onToken?: (text: string) => void
  ): Promise<MergedNotes> {
    const started = Date.now()
    const modelId =
      this.options.model ?? (this.options.provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-5')
    const model =
      this.options.provider === 'anthropic'
        ? createAnthropic({ apiKey: this.options.apiKey })(modelId)
        : createOpenAI({ apiKey: this.options.apiKey })(modelId)

    const { text } = await generateText({ model, system, prompt, temperature: 0.3 })
    onToken?.(text)
    return { markdown: text.trim(), engine: this.id, elapsedMs: Date.now() - started }
  }
}
