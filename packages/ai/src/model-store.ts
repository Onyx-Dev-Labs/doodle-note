import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { LocalModelSpec } from './catalog'

/** Known, shallow model directories only. Never copies another profile's data. */
export class LocalModelStore {
  private readonly directories: string[]
  private readonly verified = new Map<string, { stamp: string; digest: string }>()
  private readonly pending = new Map<string, Promise<string>>()

  constructor(directories: string[]) {
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
      const before = await stat(path)
      if (!before.isFile() || before.size !== spec.artifact.bytes) return false
      const stamp = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}:${before.ctimeMs}`
      const cached = this.verified.get(path)
      if (cached?.stamp === stamp) return cached.digest === spec.artifact.sha256
      // Streaming I/O keeps the Electron event loop responsive and memory bounded.
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      const after = await stat(path)
      if (stamp !== `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}`)
        return false
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
      this.verified.set(path, { stamp, digest })
      return digest === spec.artifact.sha256
    } catch {
      return false // Missing, unreadable or concurrently removed: try the next candidate.
    }
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
