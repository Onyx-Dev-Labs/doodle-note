/** One batch configuration; live caption configuration is deliberately separate. */
export interface BatchTranscriptionSettings {
  backend: 'parakeet' | 'whisper'
  parakeetModel: 'v2' | 'v3'
  language: string
}

export const WHISPER_LANGUAGES: ReadonlyArray<readonly [string, string]> = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['da', 'Danish'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['sv', 'Swedish'],
  ['no', 'Norwegian'],
  ['fi', 'Finnish'],
  ['pl', 'Polish'],
  ['uk', 'Ukrainian'],
  ['ru', 'Russian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['tr', 'Turkish'],
  ['cs', 'Czech'],
  ['el', 'Greek'],
  ['he', 'Hebrew'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese']
]

export function normalizeBatchSettings(value: unknown): BatchTranscriptionSettings {
  const raw =
    value && typeof value === 'object' ? (value as Partial<BatchTranscriptionSettings>) : {}
  return {
    backend: raw.backend === 'whisper' ? 'whisper' : 'parakeet',
    parakeetModel: raw.parakeetModel === 'v3' ? 'v3' : 'v2',
    language: WHISPER_LANGUAGES.some(([code]) => code === raw.language) ? raw.language! : 'auto'
  }
}
