/** Use the saved generation identity, never today's provider settings. */
export function generatedModelLabel(engine?: string): string {
  if (!engine) return 'an unrecorded model (older notes)'
  if (engine.startsWith('local:')) {
    const model = engine.slice(6)
    const name = /Qwen3-4B/i.test(model)
      ? 'Qwen3 4B'
      : /Llama-3\.1-8B/i.test(model)
        ? 'Llama 3.1 8B'
        : /gemma-3-12b/i.test(model)
          ? 'Gemma 3 12B'
          : 'local model'
    return `On-device · ${name}`
  }
  if (engine.startsWith('cloud:')) {
    const [, provider, ...parts] = engine.split(':')
    const names: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      gemini: 'Google Gemini',
      grok: 'Grok (xAI)',
      groq: 'Groq',
      openrouter: 'OpenRouter',
      ollama: 'Ollama'
    }
    const model = parts.join(':')
    return `${names[provider] ?? provider} · ${!model || model === 'default' ? 'default model (exact version not recorded)' : model}`
  }
  return 'an unrecognized model'
}
