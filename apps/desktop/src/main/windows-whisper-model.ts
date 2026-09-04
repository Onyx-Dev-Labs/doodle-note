import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { get as httpsGet } from 'node:https'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

export const WINDOWS_WHISPER_MODEL = 'sherpa-onnx-whisper-tiny.en'
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${WINDOWS_WHISPER_MODEL}.tar.bz2`
const ARCHIVE_SHA256 = '2bd6cf965c8bb3e068ef9fa2191387ee63a9dfa2a4e37582a8109641c20005dd'

export const WINDOWS_WHISPER_FILES = {
  'tiny.en-decoder.int8.onnx': 89_853_865,
  'tiny.en-encoder.int8.onnx': 12_937_772,
  'tiny.en-tokens.txt': 835_554
} as const

/** Sherpa's Whisper backend accepts less than 30 seconds per stream. */
export function splitWhisperWindows(
  samples: Float32Array,
  windowSamples = 25 * 16_000
): Float32Array[] {
  if (windowSamples <= 0) throw new Error('Whisper window size must be positive.')
  const windows: Float32Array[] = []
  for (let start = 0; start < samples.length; start += windowSamples) {
    windows.push(samples.subarray(start, start + windowSamples))
  }
  return windows
}

export function modelFilesMatch(
  dir: string,
  expected: Readonly<Record<string, number>> = WINDOWS_WHISPER_FILES
): boolean {
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

function downloadResumable(
  url: string,
  path: string,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
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
          const offset = resumed ? existing : 0
          const remaining = Number(response.headers['content-length'] ?? 0)
          const total = offset + remaining
          let received = offset
          const output = createWriteStream(path, { flags: resumed ? 'a' : 'w' })
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (total > 0) onProgress(Math.min(1, received / total))
          })
          response.on('error', reject)
          output.on('error', reject)
          output.on('finish', () => output.close(() => resolve()))
          response.pipe(output)
        }
      )
      request.setTimeout(60_000, () =>
        request.destroy(new Error('The speech model download timed out. Please try again.'))
      )
      request.on('error', reject)
    }
    follow(url, 0)
  })
}

function extract(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xjf', archive, '-C', destination], { windowsHide: true })
    tar.on('error', reject)
    tar.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('The speech model could not be unpacked.'))
    )
  })
}

/** Download, verify, and atomically install the int8 English final-pass model. */
export async function ensureWindowsWhisperModel(
  modelsDir: string,
  onProgress: (progress: number) => void
): Promise<string> {
  const target = join(modelsDir, WINDOWS_WHISPER_MODEL)
  if (modelFilesMatch(target)) return target

  mkdirSync(modelsDir, { recursive: true })
  const partial = join(modelsDir, `${WINDOWS_WHISPER_MODEL}.tar.bz2.partial`)
  await downloadResumable(MODEL_URL, partial, onProgress)
  if ((await sha256(partial)) !== ARCHIVE_SHA256) {
    rmSync(partial, { force: true })
    throw new Error('The downloaded speech model failed verification. Please try again.')
  }

  const staging = join(modelsDir, `.${WINDOWS_WHISPER_MODEL}-${randomUUID()}`)
  mkdirSync(staging, { recursive: true })
  try {
    await extract(partial, staging)
    const extracted = join(staging, WINDOWS_WHISPER_MODEL)
    if (!modelFilesMatch(extracted)) {
      throw new Error('The speech model is incomplete. Please try again.')
    }
    rmSync(join(extracted, 'tiny.en-decoder.onnx'), { force: true })
    rmSync(join(extracted, 'tiny.en-encoder.onnx'), { force: true })
    rmSync(target, { recursive: true, force: true })
    renameSync(extracted, target)
    rmSync(partial, { force: true })
    return target
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
