import type { CloudProvider, CloudModelsResult } from '../shared/notes-api'

const endpoints: Partial<Record<CloudProvider, string>> = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models?limit=100',
  grok: 'https://api.x.ai/v1/language-models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
  ollama: 'http://localhost:11434/v1/models'
}

/** Read-only catalog request. No meeting content, response bodies, or keys are logged. */
export async function fetchCloudModels(
  provider: CloudProvider,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<CloudModelsResult> {
  const endpoint = endpoints[provider]
  if (!endpoint) return { models: [], error: 'Select a supported provider.' }
  if (provider !== 'ollama' && !apiKey) return { models: [], error: 'Save an API key first.' }
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : provider === 'gemini'
        ? { 'x-goog-api-key': apiKey }
        : provider === 'ollama'
          ? {}
          : { Authorization: `Bearer ${apiKey}` }
  const models = new Map<string, { id: string; label: string }>()
  const seen = new Set<string>()
  let url = new URL(endpoint)
  try {
    const signal = AbortSignal.timeout(15000)
    for (let page = 0; page < 20; page++) {
      const response = await request(url, { headers, signal, redirect: 'error' })
      if (!response.ok) {
        const error =
          response.status === 401
            ? 'The provider rejected this API key.'
            : response.status === 403
              ? 'This key does not have permission to list models. You can enter a model ID manually.'
              : response.status === 429
                ? 'The provider is rate limiting requests. Try again shortly.'
                : `Could not load models (HTTP ${response.status}). Try again or enter a model ID manually.`
        return { models: [], error }
      }
      const body = (await response.json()) as Record<string, unknown>
      const rows = provider === 'gemini' || provider === 'grok' ? body.models : body.data
      if (!Array.isArray(rows)) throw new Error('Invalid catalog')
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const raw = provider === 'gemini' ? row.name : row.id
        if (typeof raw !== 'string' || raw.length > 256) continue
        const id = raw.replace(/^models\//, '')
        if (!id) continue
        if (
          provider === 'gemini' &&
          (!Array.isArray(row.supportedGenerationMethods) ||
            !row.supportedGenerationMethods.includes('generateContent'))
        )
          continue
        // OpenAI's general catalog includes non-chat models. Preserve manual entry
        // for custom/new IDs rather than claiming this heuristic proves compatibility.
        if (
          provider === 'openai' &&
          (!/^(gpt-|chatgpt-|o\d|ft:(gpt-|o\d))/.test(id) ||
            /audio|realtime|transcrib|tts|image|search|deep-research/.test(id))
        )
          continue
        if (provider === 'gemini' && /image|tts|audio|robotics|computer-use/.test(id)) continue
        const display = row.display_name ?? row.displayName
        models.set(id, {
          id,
          label: typeof display === 'string' && display.length < 256 ? display : id
        })
      }
      const token =
        provider === 'gemini'
          ? body.nextPageToken
          : provider === 'anthropic' && body.has_more === true
            ? body.last_id
            : undefined
      if (!token) return { models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)) }
      if (typeof token !== 'string' || seen.has(token)) throw new Error('Invalid pagination')
      seen.add(token)
      url = new URL(endpoint)
      url.searchParams.set(provider === 'gemini' ? 'pageToken' : 'after_id', token)
    }
    return {
      models: [...models.values()],
      error:
        'The provider returned too many pages. This list is incomplete; enter a model ID manually if needed.'
    }
  } catch {
    return {
      models: [],
      error:
        'Could not reach the model catalog. Check your connection and try again, or enter a model ID manually.'
    }
  }
}
