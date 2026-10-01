import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BatchOptions, BatchProgress, BatchTranscription } from './import-logic'
import { assembleBatchTokens } from './import-logic'
import type { EngineTokenTiming } from '../shared/engine-events'
import { WHISPER_LANGUAGES } from '../shared/batch-transcription'
import { ensureWhisperModel } from './whisper-model'
import { runBatchChild } from './batch-child'

export function whisperTokens(value: unknown): EngineTokenTiming[] {
  const data = value as {
    transcription?: Array<{
      text?: string
      offsets?: { from: number; to: number }
      tokens?: Array<{ text: string; p: number; offsets?: { from: number; to: number } }>
    }>
  }
  if (!Array.isArray(data.transcription)) throw new Error('Whisper returned an invalid transcript.')
  const tokens: EngineTokenTiming[] = []
  for (const segment of data.transcription) {
    for (const token of segment.tokens ?? []) {
      if (token.text.startsWith('[_') || token.text.startsWith('<|')) continue
      const timing = token.offsets ?? segment.offsets
      if (
        !timing ||
        !Number.isFinite(timing.from) ||
        !Number.isFinite(timing.to) ||
        timing.from < 0 ||
        timing.to < timing.from
      )
        continue
      tokens.push({
        token: token.text,
        startSec: timing.from / 1000,
        endSec: timing.to / 1000,
        confidence: Number.isFinite(token.p) ? token.p : 0
      })
    }
  }
  return tokens
}

export async function transcribeWithWhisper(
  engine: string,
  whisper: string,
  modelDirectory: string,
  file: string,
  onProgress?: (progress: BatchProgress) => void,
  options: BatchOptions = {}
): Promise<BatchTranscription> {
  const language = options.settings?.language ?? 'auto'
  if (!WHISPER_LANGUAGES.some(([code]) => code === language))
    throw new Error('Unsupported Whisper language. Choose a language in Settings.')
  options.signal?.throwIfAborted()
  try {
    await access(whisper, constants.X_OK)
    await access(engine, constants.X_OK)
  } catch {
    throw new Error(
      'The local Whisper engine is missing or cannot run. Reinstall this version of DoodleNote.'
    )
  }
  const model = await ensureWhisperModel(modelDirectory, options.signal, (progress) =>
    onProgress?.({ stage: 'downloading_model', progress })
  )
  const directory = await mkdtemp(join(tmpdir(), 'doodlenote-whisper-'))
  try {
    onProgress?.({ stage: 'starting' })
    const output = await runBatchChild(
      engine,
      [
        'prepare-batch-audio',
        '--file',
        file,
        '--channels',
        options.channels ?? 'mixed',
        '--output-dir',
        directory
      ],
      options.signal
    )
    const prepared = output
      .split('\n')
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
      .find((event) => event.event === 'prepared')
    if (!prepared || !Array.isArray(prepared.channels) || !Number.isFinite(prepared.audioSeconds))
      throw new Error('Could not prepare the audio for Whisper.')
    const tokens: { mic: EngineTokenTiming[]; system: EngineTokenTiming[] } = {
      mic: [],
      system: []
    }
    for (const channel of prepared.channels) {
      if (channel !== 'mic' && channel !== 'system')
        throw new Error('Invalid prepared audio channel.')
      onProgress?.({ stage: 'transcribing' })
      const prefix = join(directory, `${channel}-transcript`)
      await runBatchChild(
        whisper,
        [
          '-m',
          model,
          '-f',
          join(directory, `${channel}.wav`),
          '-l',
          language,
          '-ojf',
          '-of',
          prefix,
          '-np'
        ],
        options.signal
      )
      tokens[channel] = whisperTokens(JSON.parse(await readFile(`${prefix}.json`, 'utf8')))
    }
    return {
      segments: assembleBatchTokens(tokens, options.channels ?? 'mixed'),
      audioSeconds: prepared.audioSeconds
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
