import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const WHISPER_MODEL = {
  filename: 'ggml-large-v3-turbo.bin',
  bytes: 1624555275,
  sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin'
} as const

export async function verifyModel(
  path: string,
  expected: { bytes: number; sha256: string },
  signal?: AbortSignal
): Promise<boolean> {
  signal?.throwIfAborted()
  try {
    if ((await stat(path)).size !== expected.bytes) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
    return hash.digest('hex') === expected.sha256
  } catch (error) {
    signal?.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Atomic verified cache. Models stay under app support, outside the content library.
 * Called only when the user has explicitly selected Whisper for a batch job. */
export async function ensureWhisperModel(
  directory: string,
  signal?: AbortSignal,
  progress?: (fraction: number) => void,
  descriptor: { filename: string; bytes: number; sha256: string; url: string } = WHISPER_MODEL
): Promise<string> {
  const path = join(directory, descriptor.filename)
  if (await verifyModel(path, descriptor, signal)) return path
  signal?.throwIfAborted()
  await mkdir(directory, { recursive: true })
  const temporary = `${path}.${randomUUID()}.partial`
  try {
    const response = await fetch(descriptor.url, { signal, redirect: 'follow' })
    if (!response.ok || !response.body)
      throw new Error(`Whisper model download failed (${response.status}). Retry when connected.`)
    let received = 0
    const hash = createHash('sha256')
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > descriptor.bytes)
          return callback(new Error('Whisper model download exceeded its expected size.'))
        hash.update(chunk)
        progress?.(received / descriptor.bytes)
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as never),
      meter,
      createWriteStream(temporary, { flags: 'wx' }),
      { signal }
    )
    signal?.throwIfAborted()
    if (received !== descriptor.bytes || hash.digest('hex') !== descriptor.sha256)
      throw new Error('Whisper model integrity check failed. Please retry the download.')
    await rename(temporary, path)
    return path
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
