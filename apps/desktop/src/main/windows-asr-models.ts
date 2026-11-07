import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { get as httpsGet } from 'node:https'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Windows speech models, downloaded on first use from the pinned k2-fsa
 * sherpa-onnx `asr-models` release (the source the app has always used).
 * Every archive is verified by SHA256 before extraction, extracted into a
 * private staging folder, checked file-by-file, and promoted with one rename.
 * Folders from older builds (the streaming Zipformer and Whisper tiny.en)
 * are never touched.
 */
const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

export interface WindowsAsrModelSpec {
  /** Folder name under the models directory (also the archive stem). */
  name: string
  url: string
  /** Size and SHA256 of the downloaded asset. */
  bytes: number
  sha256: string
  /** 'archive' assets are .tar.bz2; 'file' assets are a single model file. */
  kind: 'archive' | 'file'
  /** Files kept after extraction, with their exact sizes. */
  files: Readonly<Record<string, number>>
  /** SHA256 of each kept file, checked when a model fails to load. */
  fileSha256?: Readonly<Record<string, string>>
}

function archive(
  name: string,
  bytes: number,
  sha256: string,
  files: Record<string, number>,
  fileSha256: Record<string, string>
): WindowsAsrModelSpec {
  return {
    name,
    url: `${RELEASE}/${name}.tar.bz2`,
    bytes,
    sha256,
    kind: 'archive',
    files,
    fileSha256
  }
}

/**
 * Live captions: NVIDIA Parakeet Unified 0.6b (int8), the model the Mac's live
 * engine uses, in its full-context export. Windows decodes it per utterance;
 * the buffered streaming exports cost 12-40x more CPU (see WINDOWS-RELEASE-QA).
 */
export const PARAKEET_UNIFIED = archive(
  'sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming',
  501_350_460,
  '99f63605b3a85a54c250c0869670a687b7d6598a47bf2421515e1f839a76e150',
  {
    'encoder.int8.onnx': 654_040_552,
    'decoder.int8.onnx': 7_257_753,
    'joiner.int8.onnx': 1_735_860,
    'tokens.txt': 8_952
  },
  {
    'encoder.int8.onnx': '6716910b7a0833997fec7a410494c995d70124001a0e9b66d6370d6aced577e0',
    'decoder.int8.onnx': 'a5e223392c90e75f8144cdb5eb95af7625db389e39edef2bd1a9c872b3298fe6',
    'joiner.int8.onnx': '869f43f7d24595c55581ad3bf249a935fb8a71389fbdaa7504b9f46f93140f8a',
    'tokens.txt': 'dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff'
  }
)

/** English Parakeet TDT 0.6b v2 (int8): the default batch model, as on the Mac. */
export const PARAKEET_TDT_V2 = archive(
  'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  482_468_385,
  '157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad',
  {
    'encoder.int8.onnx': 652_184_296,
    'decoder.int8.onnx': 7_257_753,
    'joiner.int8.onnx': 1_739_080,
    'tokens.txt': 9_384
  },
  {
    'encoder.int8.onnx': 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab',
    'decoder.int8.onnx': 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e',
    'joiner.int8.onnx': '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2',
    'tokens.txt': 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d'
  }
)

/** Multilingual Parakeet TDT 0.6b v3 (int8): the batch "Multilingual" option. */
export const PARAKEET_TDT_V3 = archive(
  'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  487_170_055,
  '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf',
  {
    'encoder.int8.onnx': 652_184_281,
    'decoder.int8.onnx': 11_845_275,
    'joiner.int8.onnx': 6_355_277,
    'tokens.txt': 93_939
  },
  {
    'encoder.int8.onnx': 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
    'decoder.int8.onnx': '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
    'joiner.int8.onnx': '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
    'tokens.txt': 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d'
  }
)

/** Silero VAD: utterance boundaries for live captions and long imports. */
export const SILERO_VAD: WindowsAsrModelSpec = {
  name: 'silero-vad',
  url: `${RELEASE}/silero_vad.onnx`,
  bytes: 643_854,
  sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
  kind: 'file',
  files: { 'silero_vad.onnx': 643_854 },
  fileSha256: {
    'silero_vad.onnx': '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'
  }
}

export function parakeetSpec(model: 'v2' | 'v3'): WindowsAsrModelSpec {
  return model === 'v3' ? PARAKEET_TDT_V3 : PARAKEET_TDT_V2
}

export function modelFilesMatch(dir: string, expected: Readonly<Record<string, number>>): boolean {
  return Object.entries(expected).every(([name, size]) => {
    try {
      return statSync(join(dir, name)).size === size
    } catch {
      return false
    }
  })
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export type ModelDownloader = (
  url: string,
  path: string,
  onProgress: (receivedBytes: number) => void,
  signal?: AbortSignal
) => Promise<void>

export type ModelExtractor = (archive: string, destination: string) => Promise<void>

function canceled(): Error {
  const error = new Error('The speech model download was canceled.')
  error.name = 'AbortError'
  return error
}

/** HTTP download that resumes `path` with a Range request when it exists. */
export const downloadResumable: ModelDownloader = (url, path, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(canceled())
    const follow = (target: string, redirects: number): void => {
      if (redirects > 5) return reject(new Error('Too many model download redirects.'))
      const existing = existsSync(path) ? statSync(path).size : 0
      const request = httpsGet(
        target,
        existing > 0 ? { headers: { Range: `bytes=${existing}-` } } : {},
        (response) => {
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume()
            follow(new URL(response.headers.location, target).toString(), redirects + 1)
            return
          }
          if (response.statusCode === 416 && existing > 0) {
            response.resume()
            resolve()
            return
          }
          if (response.statusCode !== 200 && response.statusCode !== 206) {
            response.resume()
            reject(new Error(`Model download failed (HTTP ${response.statusCode ?? 'unknown'}).`))
            return
          }
          const resumed = response.statusCode === 206
          let received = resumed ? existing : 0
          onProgress(received)
          const output = createWriteStream(path, { flags: resumed ? 'a' : 'w' })
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            onProgress(received)
          })
          response.on('error', reject)
          output.on('error', reject)
          output.on('finish', () => output.close(() => resolve()))
          response.pipe(output)
        }
      )
      const abort = (): void => {
        request.destroy(canceled())
      }
      signal?.addEventListener('abort', abort, { once: true })
      request.on('close', () => signal?.removeEventListener('abort', abort))
      request.setTimeout(90_000, () =>
        request.destroy(new Error('The speech model download stalled. Please try again.'))
      )
      request.on('error', reject)
    }
    follow(url, 0)
  })

/** Windows 10+ ships bsdtar as tar.exe; -xjf handles .tar.bz2. */
export const extractArchive: ModelExtractor = (archivePath, destination) =>
  new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xjf', archivePath, '-C', destination], { windowsHide: true })
    tar.on('error', reject)
    tar.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('The speech model could not be unpacked.'))
    )
  })

export interface EnsureModelOptions {
  signal?: AbortSignal
  download?: ModelDownloader
  extract?: ModelExtractor
  /**
   * Distinguishes the partial download of each worker kind, so the live and
   * import workers never write the same partial file (both need the VAD).
   */
  partialTag?: string
}

/**
 * Return the installed model folder, downloading it first when needed.
 * `onProgress` receives 0..1 for this asset. A partial download survives an
 * interrupted attempt and is resumed next time; a corrupt one is discarded.
 */
export async function ensureWindowsAsrModel(
  modelsDir: string,
  spec: WindowsAsrModelSpec,
  onProgress: (progress: number) => void,
  options: EnsureModelOptions = {}
): Promise<string> {
  const target = join(modelsDir, spec.name)
  if (modelFilesMatch(target, spec.files)) return target
  const download = options.download ?? downloadResumable
  const extract = options.extract ?? extractArchive

  mkdirSync(modelsDir, { recursive: true })
  const partial = join(
    modelsDir,
    `${spec.name}${options.partialTag ? `.${options.partialTag}` : ''}.download.partial`
  )
  if (existsSync(partial) && statSync(partial).size > spec.bytes) rmSync(partial, { force: true })
  await download(
    spec.url,
    partial,
    (received) => onProgress(Math.min(1, received / spec.bytes)),
    options.signal
  )
  options.signal?.throwIfAborted()
  if (statSync(partial).size !== spec.bytes || (await sha256(partial)) !== spec.sha256) {
    rmSync(partial, { force: true })
    throw new Error('The downloaded speech model failed verification. Please try again.')
  }

  const staging = join(modelsDir, `.${spec.name}-${randomUUID()}`)
  mkdirSync(staging, { recursive: true })
  try {
    let extracted: string
    if (spec.kind === 'archive') {
      await extract(partial, staging)
      extracted = join(staging, spec.name)
    } else {
      extracted = join(staging, spec.name)
      mkdirSync(extracted)
      renameSync(partial, join(extracted, Object.keys(spec.files)[0]!))
    }
    if (!modelFilesMatch(extracted, spec.files)) {
      throw new Error('The speech model is incomplete. Please try again.')
    }
    // Archives also carry sample audio the app never reads. Model-card notes
    // (licence, bias, safety) stay next to the model.
    for (const entry of readdirSync(extracted)) {
      if (!(entry in spec.files) && !/\.(md|txt)$/i.test(entry)) {
        rmSync(join(extracted, entry), { recursive: true, force: true })
      }
    }
    // Another worker may have installed (and loaded) the same model meanwhile.
    if (!modelFilesMatch(target, spec.files)) {
      rmSync(target, { recursive: true, force: true })
      renameSync(extracted, target)
    }
    rmSync(partial, { force: true })
    return target
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Download several assets as one progress bar weighted by size. */
export async function ensureWindowsAsrModels(
  modelsDir: string,
  specs: readonly WindowsAsrModelSpec[],
  onProgress: (progress: number) => void,
  options: EnsureModelOptions = {}
): Promise<string[]> {
  const total = specs.reduce((sum, spec) => sum + spec.bytes, 0)
  let done = 0
  const dirs: string[] = []
  for (const spec of specs) {
    dirs.push(
      await ensureWindowsAsrModel(
        modelsDir,
        spec,
        (progress) => onProgress(Math.min(1, (done + progress * spec.bytes) / total)),
        options
      )
    )
    done += spec.bytes
  }
  return dirs
}

/**
 * Size checks are cheap and run at every start; content hashes run only after
 * a model failed to load (or a load was interrupted), to tell a damaged file
 * from any other failure.
 */
export async function modelContentMatches(
  dir: string,
  spec: WindowsAsrModelSpec
): Promise<boolean> {
  if (!modelFilesMatch(dir, spec.files)) return false
  for (const [name, expected] of Object.entries(spec.fileSha256 ?? {})) {
    try {
      if ((await sha256(join(dir, name))) !== expected) return false
    } catch {
      return false
    }
  }
  return true
}

/** Remove an installed model folder so the next ensure downloads it again. */
export function removeWindowsAsrModel(modelsDir: string, spec: WindowsAsrModelSpec): void {
  rmSync(join(modelsDir, spec.name), { recursive: true, force: true })
}

/** Whether a model still needs to be downloaded (for first-run copy). */
export function windowsAsrModelMissing(modelsDir: string, spec: WindowsAsrModelSpec): boolean {
  return !modelFilesMatch(join(modelsDir, spec.name), spec.files)
}
