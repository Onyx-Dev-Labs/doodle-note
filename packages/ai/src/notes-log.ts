import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface NotesDiagnostic {
  event:
    | 'runtime'
    | 'load'
    | 'hash'
    | 'context'
    | 'prefill'
    | 'generation'
    | 'fallback'
    | 'failure'
    | 'warmup'
    | 'idle-dispose'
  modelId?: string
  backend?: 'vulkan' | 'metal' | 'cpu' | 'cuda' | 'unknown'
  stage?: 'runtime' | 'load' | 'context' | 'generation' | 'condensing' | 'settings' | 'global-chat'
  reason?:
    | 'start'
    | 'complete'
    | 'cancel'
    | 'disabled'
    | 'cloud'
    | 'battery'
    | 'busy'
    | 'memory'
    | 'no-model'
    | 'no-meeting'
  cached?: boolean
  prefixReused?: boolean
  gpuLayers?: number
  loadMs?: number
  hashMs?: number
  contextSize?: number
  contextCreateMs?: number
  skippedTokens?: number
  promptTokens?: number
  evaluatedTokens?: number
  prefillMs?: number
  prefillTokensPerSecond?: number
  generatedTokens?: number
  generationMs?: number
  generatedTokensPerSecond?: number
  error?: unknown
}
export type NotesDiagnosticSink = (event: NotesDiagnostic) => void

/** Arbitrary native exceptions can embed input. Persist a classified message, never raw text/stack. */
function safeError(error: unknown): { errorClass: string; message: string; timeout: boolean } {
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown } | null
  const name = typeof candidate?.name === 'string' ? candidate.name : ''
  const text = typeof candidate?.message === 'string' ? candidate.message : ''
  const errorClass = [
    'Error',
    'TypeError',
    'RangeError',
    'AggregateError',
    'GenerationError',
    'AbortError',
    'NoBinaryFoundError'
  ].includes(name)
    ? name
    : 'Error'
  const timeout = candidate?.code === 'timeout' || /timed out|timeout/i.test(text)
  const message = timeout
    ? 'Model operation timed out.'
    : candidate?.code === 'canceled' || name === 'AbortError'
      ? 'Model operation canceled.'
      : /NoBinaryFoundError|No usable .*runtime|no.*binary/i.test(text)
        ? 'No usable native runtime.'
        : /out of memory|allocat.*fail|insufficient.*memory/i.test(text)
          ? 'Native memory allocation failed.'
          : 'Model operation failed; unclassified details omitted for content privacy.'
  return { errorClass, message, timeout }
}

/** Append-only within each file, serialized rotation, one old file, never throws into inference. */
export class NotesEngineLog {
  private pending: Promise<void> = Promise.resolve()
  constructor(
    private readonly file: string,
    private readonly maxBytes = 1024 * 1024
  ) {}

  readonly log: NotesDiagnosticSink = (event) => {
    // Construct an allowlisted record instead of serializing event/error objects.
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      event: event.event
    }
    if (event.modelId) record.modelId = event.modelId
    for (const key of ['backend', 'stage', 'reason', 'cached', 'prefixReused'] as const)
      if (event[key] !== undefined) record[key] = event[key]
    for (const key of [
      'gpuLayers',
      'loadMs',
      'hashMs',
      'contextSize',
      'contextCreateMs',
      'skippedTokens',
      'promptTokens',
      'evaluatedTokens',
      'prefillMs',
      'prefillTokensPerSecond',
      'generatedTokens',
      'generationMs',
      'generatedTokensPerSecond'
    ] as const)
      if (typeof event[key] === 'number' && Number.isFinite(event[key])) record[key] = event[key]
    if (event.error !== undefined) Object.assign(record, safeError(event.error))
    const line = `${JSON.stringify(record)}\n`
    this.pending = this.pending
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        let size = 0
        try {
          size = (await stat(this.file)).size
        } catch {
          /* first append */
        }
        if (size + Buffer.byteLength(line) > this.maxBytes) {
          await rm(`${this.file}.old`, { force: true })
          if (size) await rename(this.file, `${this.file}.old`)
        }
        await appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 })
      })
      .catch(() => {
        /* Diagnostics cannot fail a recording or model operation. */
      })
  }

  flush(): Promise<void> {
    return this.pending
  }
}
