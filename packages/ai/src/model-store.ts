import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  readFile,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { LocalModelSpec } from './catalog'

interface IntegrityVerdict {
  version: 1
  mac: string
  path: string
  size: number
  mtime: number
  ctime: number
  dev: number
  ino: number
  sha256: string
}
export interface ModelStoreOptions {
  /** Profile-owned cache; never written beside shared model artifacts. */
  verdictPath?: string
  /** Electron safeStorage: DPAPI/Keychain (never Linux's plaintext fallback). */
  receiptStorage?: {
    isEncryptionAvailable(): boolean
    encryptString(value: string): Buffer
    decryptString(value: Buffer): string
    getSelectedStorageBackend?(): string
  }
  onIntegrityCheck?: (event: { modelId: string; cached: boolean; hashMs: number }) => void
}
const MAX_VERDICTS = 64
const MAX_VERDICT_BYTES = 64 * 1024

function stamp(file: Awaited<ReturnType<typeof stat>>): string {
  return `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`
}
function verdictStamp(verdict: IntegrityVerdict): string {
  return `${verdict.dev}:${verdict.ino}:${verdict.size}:${verdict.mtime}:${verdict.ctime}`
}
function validVerdict(value: unknown): value is IntegrityVerdict {
  if (!value || typeof value !== 'object') return false
  const v = value as IntegrityVerdict
  return (
    v.version === 1 &&
    typeof v.mac === 'string' &&
    /^[a-f0-9]{64}$/.test(v.mac) &&
    typeof v.path === 'string' &&
    v.path.length < 4096 &&
    typeof v.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(v.sha256) &&
    [v.size, v.mtime, v.ctime, v.dev, v.ino].every(
      (n) => typeof n === 'number' && Number.isFinite(n)
    )
  )
}

/** Known, shallow model directories only. Never copies another profile's data. */
export class LocalModelStore {
  private readonly directories: string[]
  private readonly verified = new Map<string, { stamp: string; digest: string }>()
  private readonly pending = new Map<string, Promise<string>>()

  private readonly verdicts = new Map<string, IntegrityVerdict>()
  private receiptKey: Buffer | null = null
  private verdictLoad: Promise<void> | null = null
  private verdictWrite: Promise<void> = Promise.resolve()

  constructor(
    directories: string[],
    private readonly options: ModelStoreOptions = {}
  ) {
    this.directories = [...new Set(directories.map((directory) => resolve(directory)))]
    if (!this.directories.length) throw new Error('A model download directory is required.')
  }

  private async complete(file: string, spec: LocalModelSpec): Promise<boolean> {
    try {
      const path = await realpath(file)
      // Check both the reference and its target in case a cache uses symlinks.
      for (const marker of new Set([`${file}.ipull`, `${path}.ipull`])) {
        try {
          await access(marker)
          return false
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
        }
      }
      await this.loadVerdicts()
      const before = await stat(path)
      if (!before.isFile() || before.size !== spec.artifact.bytes) return false
      const beforeStamp = stamp(before)
      const cached = this.verified.get(path)
      const persistent = this.verdicts.get(path)
      const digestCached =
        cached?.stamp === beforeStamp
          ? cached.digest
          : persistent &&
              persistent.sha256 === spec.artifact.sha256 &&
              verdictStamp(persistent) === beforeStamp
            ? persistent.sha256
            : undefined
      if (digestCached !== undefined) {
        this.options.onIntegrityCheck?.({
          modelId: spec.id,
          cached: true,
          hashMs: 0
        })
        return digestCached === spec.artifact.sha256
      }
      const started = Date.now()
      // Streaming I/O keeps the Electron event loop responsive and memory bounded.
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      const after = await stat(path)
      if (beforeStamp !== stamp(after)) return false
      if ((await realpath(file)) !== path) return false
      for (const marker of new Set([`${file}.ipull`, `${path}.ipull`])) {
        try {
          await access(marker)
          return false
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false
        }
      }
      const digest = hash.digest('hex')
      this.verified.set(path, { stamp: beforeStamp, digest })
      this.options.onIntegrityCheck?.({
        modelId: spec.id,
        cached: false,
        hashMs: Date.now() - started
      })
      // Persist successful catalog verdicts only, bounded even with many candidates.
      if (digest === spec.artifact.sha256 && this.receiptKey) {
        this.verdicts.delete(path)
        const verdict: IntegrityVerdict = {
          version: 1,
          mac: '',
          path,
          size: before.size,
          mtime: before.mtimeMs,
          ctime: before.ctimeMs,
          dev: before.dev,
          ino: before.ino,
          sha256: digest
        }
        verdict.mac = this.authenticate(verdict)
        this.verdicts.set(path, verdict)
        while (this.verdicts.size > MAX_VERDICTS)
          this.verdicts.delete(this.verdicts.keys().next().value!)
        await this.saveVerdicts()
      }
      return digest === spec.artifact.sha256
    } catch {
      return false // Missing, unreadable or concurrently removed: try the next candidate.
    }
  }

  private authenticate(v: IntegrityVerdict): string {
    // Fixed field order binds the canonical path, every stat field, catalog
    // digest and schema. No user-controlled property ordering affects the MAC.
    return createHmac('sha256', this.receiptKey!)
      .update(JSON.stringify([v.version, v.path, v.size, v.mtime, v.ctime, v.dev, v.ino, v.sha256]))
      .digest('hex')
  }

  private async loadReceiptKey(): Promise<Buffer | null> {
    const storage = this.options.receiptStorage
    const file = this.options.verdictPath
    try {
      if (
        !file ||
        !storage?.isEncryptionAvailable() ||
        storage.getSelectedStorageBackend?.() === 'basic_text'
      )
        return null
      const keyPath = `${file}.key`
      const read = async (): Promise<Buffer> => {
        if ((await stat(keyPath)).size > 4096) throw new Error('Invalid receipt key')
        const plain = storage.decryptString(await readFile(keyPath))
        if (!/^[a-f0-9]{64}$/.test(plain)) throw new Error('Invalid receipt key')
        return Buffer.from(plain, 'hex')
      }
      try {
        return await read()
      } catch (error) {
        // A failed decryption must rehash, never trust or replace this key.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
      }
      const key = randomBytes(32)
      const encrypted = storage.encryptString(key.toString('hex'))
      await mkdir(dirname(keyPath), { recursive: true })
      try {
        await writeFile(keyPath, encrypted, { mode: 0o600, flag: 'wx' })
        return key
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return await read()
        return null
      }
    } catch {
      return null // No secure storage means launch-time hashing, as before.
    }
  }

  private loadVerdicts(): Promise<void> {
    return (this.verdictLoad ??= (async () => {
      const file = this.options.verdictPath
      if (!file) return
      this.receiptKey = await this.loadReceiptKey()
      if (!this.receiptKey) return
      try {
        if ((await stat(file)).size > MAX_VERDICT_BYTES) return
        const data: unknown = JSON.parse(await readFile(file, 'utf8'))
        if (!Array.isArray(data) || data.length > MAX_VERDICTS || !data.every(validVerdict)) return
        for (const verdict of data) {
          if (
            timingSafeEqual(
              Buffer.from(verdict.mac, 'hex'),
              Buffer.from(this.authenticate(verdict), 'hex')
            )
          )
            this.verdicts.set(verdict.path, verdict)
        }
      } catch {
        /* Missing/corrupt cache: stream and verify the model normally. */
      }
    })())
  }

  private saveVerdicts(): Promise<void> {
    const file = this.options.verdictPath
    if (!file || !this.receiptKey) return Promise.resolve()
    this.verdictWrite = this.verdictWrite.then(async () => {
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        const data = JSON.stringify([...this.verdicts.values()])
        if (Buffer.byteLength(data) > MAX_VERDICT_BYTES) return
        await mkdir(dirname(file), { recursive: true })
        await writeFile(temporary, data, { mode: 0o600, flag: 'wx' })
        await rename(temporary, file)
      } catch {
        /* A read-only/full profile must not prevent verified inference. */
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
    return this.verdictWrite
  }

  async find(spec: LocalModelSpec): Promise<string | null> {
    for (const directory of this.directories) {
      let names: string[]
      try {
        names = await readdir(directory)
      } catch {
        continue
      }
      for (const name of names.sort()) {
        if (!name.toLowerCase().endsWith('.gguf')) continue
        const file = join(directory, name)
        if (await this.complete(file, spec)) return file
      }
    }
    return null
  }

  /** Only explicit activation supplies a downloader. A missing model during
   * generation must return an actionable error instead of silently downloading. */
  ensure(spec: LocalModelSpec, download: (directory: string) => Promise<string>): Promise<string> {
    const key = spec.artifact.sha256
    const pending = this.pending.get(key)
    if (pending) return pending
    const work = this.install(spec, download).finally(() => this.pending.delete(key))
    this.pending.set(key, work)
    return work
  }

  private async install(
    spec: LocalModelSpec,
    download: (directory: string) => Promise<string>
  ): Promise<string> {
    const found = await this.find(spec) // Do not cache earlier misses from the UI.
    if (found) return found
    const directory = this.directories[0]!
    await mkdir(directory, { recursive: true })
    const staging = await mkdtemp(join(directory, '.download-'))
    try {
      const file = await download(staging)
      if (!(await this.complete(file, spec))) {
        throw new Error('Model verification failed. Retry the download in Settings → Notes model.')
      }
      // Another profile may have finished while we downloaded. Leave it untouched.
      const available = await this.find(spec)
      if (available) return available
      // Unique name avoids overwriting any existing file, including corrupt ones.
      const target = join(directory, `${spec.id}-${randomUUID()}.gguf`)
      await rename(file, target)
      return target
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
}
