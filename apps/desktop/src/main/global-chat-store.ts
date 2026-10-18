import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { GlobalChatEntry } from '../shared/notes-api'
import { validateSnapshotStructure } from './cited-ask-validation'
export const CITED_CHAT_FALLBACK = 'Open this answer in a version with cited Ask support.'
type StoreIo = { fsync: typeof fsyncSync; rename: typeof renameSync }
/** Single main owner; synchronous atomic commits serialize without a late async write. */
export class GlobalChatStore {
  private revision = 0
  private path = ''
  private readonly io: StoreIo
  constructor(
    private readonly filename: () => string,
    private readonly assertAvailable: () => void,
    io: Partial<StoreIo> = {}
  ) {
    this.io = { fsync: fsyncSync, rename: renameSync, ...io }
  }
  private currentPath(): string {
    this.assertAvailable()
    const path = this.filename()
    if (this.path !== path) {
      this.path = path
      this.revision++
    }
    return path
  }
  epoch(): number {
    this.currentPath()
    return this.revision
  }
  private bytes(path: string): string | null {
    try {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
        throw new Error('Chat history is unsupported; existing bytes are preserved.')
      return readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  private parse(bytes: string | null): GlobalChatEntry[] {
    if (bytes === null) return []
    const value: unknown = JSON.parse(bytes)
    if (!Array.isArray(value))
      throw new Error('Chat history is invalid; existing bytes are preserved.')
    const ids = new Set<string>()
    for (const entry of value) {
      if (entry?.id) {
        if (ids.has(entry.id))
          throw new Error('Duplicate history identity; existing bytes are preserved.')
        ids.add(entry.id)
      }
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.question !== 'string' ||
        typeof entry.answer !== 'string' ||
        typeof entry.askedAt !== 'string' ||
        (entry.id !== undefined && (typeof entry.id !== 'string' || !entry.id))
      )
        throw new Error('Unsupported chat entry; existing bytes are preserved.')
      if ('citedAnswer' in entry) {
        validateSnapshotStructure(entry.citedAnswer)
        if (entry.answer !== CITED_CHAT_FALLBACK)
          throw new Error('Unsafe cited history fallback; existing bytes are preserved.')
      }
    }
    return value as GlobalChatEntry[]
  }
  read(): GlobalChatEntry[] {
    const path = this.currentPath()
    return this.parse(this.bytes(path))
  }
  append(entry: GlobalChatEntry, expectedEpoch: number): void {
    const path = this.currentPath()
    if (expectedEpoch !== this.revision)
      throw new Error('History changed or was cleared. Nothing saved.')
    const before = this.bytes(path)
    const entries = this.parse(before)
    const previous = entry.id ? entries.find((e) => e.id === entry.id) : undefined
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(entry))
        throw new Error('This run ID belongs to a different saved answer.')
      return
    }
    this.commit([...entries, entry], path, before, expectedEpoch)
  }
  clear(): void {
    const path = this.currentPath()
    this.revision++
    const before = this.bytes(path)
    this.parse(before)
    this.commit([], path, before, this.revision)
  }
  private commit(
    entries: GlobalChatEntry[],
    path: string,
    before: string | null,
    epoch: number
  ): void {
    const data = JSON.stringify(entries, null, 2)
    this.parse(data)
    if (Buffer.byteLength(data) > 64 * 1024 * 1024)
      throw new Error('Chat history capacity reached. Existing history is preserved.')
    const temporary = join(dirname(path), `.global-chat-${randomUUID()}.tmp`)
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx', 0o600)
      writeFileSync(fd, data)
      this.io.fsync(fd)
      closeSync(fd)
      fd = undefined
      if (this.currentPath() !== path || this.revision !== epoch || this.bytes(path) !== before)
        throw new Error('History changed during save; nothing was overwritten.')
      this.io.rename(temporary, path)
    } finally {
      if (fd !== undefined) closeSync(fd)
      try {
        unlinkSync(temporary)
      } catch {
        // Preserve the save error if the filesystem also refuses temporary cleanup.
      }
    }
  }
}
