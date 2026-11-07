import { createHash, randomUUID } from 'node:crypto'
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync
} from 'node:fs'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, lstat, rm, statfs } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { StorageProgress, StorageStatus } from '../shared/storage-api'

/** Only user content moves. Auth, sync cursors, settings and models stay put. */
export const LIBRARY_ENTRIES = [
  'meetings',
  'audio',
  'attachments',
  'sessions',
  'folders.json',
  'global-chat.json',
  'recipes-v1.json'
] as const
const MARKER = '.doodlenote-library.json'
interface Location {
  root: string
  id: string
}
interface Config {
  version: 1
  active?: Location
  pending?: { target: string; token: string }
  recoveryPath?: string
}
type FileEntry = { name: string; size: number; hash: string; directory: boolean }

/** Antivirus scans, Search indexing and OneDrive briefly hold freshly copied files on Windows. */
const WINDOWS_LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
/** Backoff before each retry: about 3 s in total before giving up. */
export const WINDOWS_LOCK_RETRY_DELAYS_MS = [100, 200, 400, 800, 1600]
export const WINDOWS_LOCK_RETRY_MESSAGE =
  'Windows is still using files in the destination; retrying…'
export const WINDOWS_LOCK_FAILURE_MESSAGE =
  'Windows is still using files in the destination, for example while antivirus or indexing checks them. Nothing was switched and your original library is still active. Wait a moment, then choose Retry transfer.'

/** Windows only: retry a filesystem step that a transient file lock refused. */
export async function retryWindowsFileLock<T>(
  operation: () => T | Promise<T>,
  options: {
    sleep?: (ms: number) => Promise<void>
    onRetry?: (attempt: number, error: NodeJS.ErrnoException) => void
  } = {}
): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !WINDOWS_LOCK_CODES.has(code)) throw error
      if (attempt >= WINDOWS_LOCK_RETRY_DELAYS_MS.length)
        throw new Error(WINDOWS_LOCK_FAILURE_MESSAGE, { cause: error })
      options.onRetry?.(attempt + 1, error as NodeJS.ErrnoException)
      await sleep(WINDOWS_LOCK_RETRY_DELAYS_MS[attempt])
    }
  }
}

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function manifest(root: string): Promise<FileEntry[]> {
  const result: FileEntry[] = []
  async function visit(name: string): Promise<void> {
    const path = join(root, name)
    const info = await lstat(path)
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error('The library contains a link or unsupported file. Nothing was switched.')
    }
    if (info.isDirectory()) {
      result.push({ name, size: 0, hash: '', directory: true })
      for (const child of (await readdir(path)).sort()) await visit(join(name, child))
    } else {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      result.push({ name, size: info.size, hash: hash.digest('hex'), directory: false })
    }
  }
  for (const name of LIBRARY_ENTRIES) {
    try {
      await lstat(join(root, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await visit(name)
  }
  return result
}

/** Pure filesystem controller. callers hold an exclusive library-operation barrier during transfer. */
export class LibraryStorage {
  private config: Config
  readonly configPath: string
  readonly defaultRoot: string

  constructor(
    userData: string,
    private readonly io: {
      copyFile?: typeof copyFile
      freeBytes?: (path: string) => Promise<number>
      /** Test seams for the Windows lock retry; macOS always uses the plain calls. */
      rename?: typeof renameSync
      rm?: typeof rm
      platform?: NodeJS.Platform
      sleep?: (ms: number) => Promise<void>
    } = {}
  ) {
    this.defaultRoot = realpathSync(userData)
    this.configPath = join(this.defaultRoot, 'library-location.json')
    this.config = { version: 1 }
    if (existsSync(this.configPath)) {
      const config = JSON.parse(readFileSync(this.configPath, 'utf8')) as Config
      if (
        config.version !== 1 ||
        (config.active && (!isAbsolute(config.active.root) || !config.active.id)) ||
        (config.pending &&
          (!isAbsolute(config.pending.target) || !/^[a-f0-9-]{36}$/.test(config.pending.token)))
      ) {
        throw new Error(
          'The library location setting is invalid. Restore it before opening DoodleNote.'
        )
      }
      this.config = config
    }
  }

  get root(): string {
    return this.config.active?.root ?? this.defaultRoot
  }

  status(): StorageStatus {
    return {
      currentPath: this.root,
      ...(this.config.pending ? { pendingPath: this.config.pending.target } : {}),
      ...(this.config.recoveryPath ? { recoveryPath: this.config.recoveryPath } : {})
    }
  }

  /** Never mkdir a missing configured root: a disconnected volume must not become a new library. */
  assertAvailable = (): void => {
    try {
      if (!statSync(this.root).isDirectory() || realpathSync(this.root) !== this.root)
        throw new Error()
      accessSync(this.root, constants.R_OK | constants.W_OK | constants.X_OK)
      if (this.config.active) {
        const marker = JSON.parse(readFileSync(join(this.root, MARKER), 'utf8')) as Location
        if (marker.id !== this.config.active.id) throw new Error()
      }
    } catch {
      throw new Error(
        'Your library folder is unavailable. Reconnect its drive or restore folder access, then reopen DoodleNote. The app will not use a different library.'
      )
    }
  }

  /** Native picker supplies the parent, never a renderer-supplied arbitrary path. */
  schedule(parent: string): StorageStatus {
    this.assertAvailable()
    const canonical = realpathSync(parent)
    const target = join(canonical, 'DoodleNote Library')
    if (
      !lstatSync(parent).isDirectory() ||
      contains(this.root, target) ||
      contains(target, this.root)
    ) {
      throw new Error(
        'Choose a location where the new library folder does not overlap the current library.'
      )
    }
    if (existsSync(target))
      throw new Error(
        'That folder already contains a DoodleNote Library. Choose another folder; existing libraries will not be overwritten.'
      )
    accessSync(canonical, constants.R_OK | constants.W_OK | constants.X_OK)
    this.save({ ...this.config, pending: { target, token: randomUUID() } })
    return this.status()
  }

  cancel(): StorageStatus {
    const next = { ...this.config }
    delete next.pending
    this.save(next)
    return this.status()
  }

  async finishPending(progress: (value: StorageProgress) => void = () => {}): Promise<void> {
    progress({ phase: 'verifying' })
    this.assertAvailable()
    const pending = this.config.pending
    if (!pending) return
    const { target, token } = pending
    const parent = dirname(target)
    if (
      realpathSync(parent) !== parent ||
      contains(this.root, target) ||
      contains(target, this.root)
    ) {
      throw new Error(
        'The destination changed or overlaps the current library. Cancel the change and choose another folder.'
      )
    }
    const stage = join(parent, `.doodlenote-transfer-${token}`)
    // After a crash following the final rename, only adopt our completed copy
    // if it still matches the untouched source. Never merge another library.
    if (existsSync(target)) {
      const markerPath = join(target, MARKER)
      if (
        lstatSync(target).isSymbolicLink() ||
        !existsSync(markerPath) ||
        JSON.parse(readFileSync(markerPath, 'utf8')).id !== token
      ) {
        throw new Error('The destination is no longer empty. Nothing was switched.')
      }
      const source = await manifest(this.root)
      if (JSON.stringify(source) !== JSON.stringify(await manifest(target))) {
        throw new Error(
          'The destination no longer matches the original library. Nothing was switched.'
        )
      }
    } else {
      const source = await manifest(this.root)
      const bytes = source.reduce((sum, file) => sum + file.size, 0)
      const freeBytes = this.io.freeBytes
        ? await this.io.freeBytes(parent)
        : await statfs(parent).then((space) => space.bavail * space.bsize)
      if (freeBytes < bytes + 10 * 1024 * 1024) {
        throw new Error(
          'There is not enough free space to transfer the library. Free space or choose another folder.'
        )
      }
      // Only this transaction's private staging directory may be retried/removed.
      if (existsSync(stage)) {
        if (
          lstatSync(stage).isSymbolicLink() ||
          JSON.parse(readFileSync(join(stage, MARKER), 'utf8')).id !== token
        ) {
          throw new Error(
            'The transfer staging folder cannot be verified. Choose another destination.'
          )
        }
        if ((this.io.platform ?? process.platform) === 'win32') {
          await retryWindowsFileLock(() => (this.io.rm ?? rm)(stage, { recursive: true }), {
            sleep: this.io.sleep,
            onRetry: () => progress({ phase: 'verifying', detail: WINDOWS_LOCK_RETRY_MESSAGE })
          })
        } else await rm(stage, { recursive: true })
      }
      await mkdir(stage, { mode: 0o700 })
      atomicJson(join(stage, MARKER), { id: token })
      let copied = 0
      progress({ phase: 'copying', completedBytes: 0, totalBytes: bytes })
      for (const file of source) {
        const destination = join(stage, file.name)
        if (file.directory) await mkdir(destination, { recursive: true, mode: 0o700 })
        else {
          await (this.io.copyFile ?? copyFile)(
            join(this.root, file.name),
            destination,
            constants.COPYFILE_EXCL
          )
          // Windows requires write access to flush a file handle. Keep Mac
          // read-only source permissions usable when verifying a copied library.
          const fd = openSync(destination, process.platform === 'win32' ? 'r+' : 'r')
          try {
            fsyncSync(fd)
          } finally {
            closeSync(fd)
          }
        }
        copied += file.size
        progress({ phase: 'copying', completedBytes: copied, totalBytes: bytes })
      }
      progress({ phase: 'verifying' })
      this.assertAvailable()
      if (
        JSON.stringify(source) !== JSON.stringify(await manifest(stage)) ||
        JSON.stringify(source) !== JSON.stringify(await manifest(this.root))
      ) {
        throw new Error(
          'Library verification failed or the source changed. The original library is still active.'
        )
      }
      if (existsSync(target))
        throw new Error('The destination was created during transfer. Nothing was switched.')
      if ((this.io.platform ?? process.platform) === 'win32') {
        await retryWindowsFileLock(() => (this.io.rename ?? renameSync)(stage, target), {
          sleep: this.io.sleep,
          onRetry: () => progress({ phase: 'verifying', detail: WINDOWS_LOCK_RETRY_MESSAGE })
        })
      } else renameSync(stage, target)
    }
    this.assertAvailable()
    this.save({ version: 1, active: { root: target, id: token }, recoveryPath: this.root })
    this.assertAvailable()
  }

  private save(config: Config): void {
    atomicJson(this.configPath, config)
    this.config = config
  }
}
