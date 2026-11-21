const endpoints = {
  global: 'https://api.openai.com/v1',
  us: 'https://us.api.openai.com/v1',
  eu: 'https://eu.api.openai.com/v1'
} as const

export type OpenAIRegion = keyof typeof endpoints

export function isOpenAIRegion(value: unknown): value is OpenAIRegion {
  return typeof value === 'string' && Object.hasOwn(endpoints, value)
}

export function resolveOpenAIBaseURL(region: OpenAIRegion = 'global'): string {
  if (!isOpenAIRegion(region)) throw new Error('Invalid OpenAI region.')
  return endpoints[region]
}
