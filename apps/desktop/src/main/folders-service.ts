import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  FOLDERS_CREATE_CHANNEL,
  FOLDERS_DELETE_CHANNEL,
  FOLDERS_LIST_CHANNEL,
  FOLDERS_RENAME_CHANNEL,
  type FolderRecord
} from '../shared/folders-api'
import type { MeetingsService } from './meetings-service'

/** Keep names sane on disk; the UI never sends anything near this long. */
const MAX_NAME_LENGTH = 80

/**
 * Owns the folders store: a single JSON array at userData/folders.json.
 * Deleting a folder sweeps the meetings store so its meetings fall back to
 * "My notes" (folderId: null) — meetings themselves are never deleted here.
 */
export class FoldersService {
  constructor(
    private readonly file: string,
    private readonly meetings: MeetingsService
  ) {}

  registerIpc(): void {
    ipcMain.handle(FOLDERS_LIST_CHANNEL, () => this.list())
    ipcMain.handle(FOLDERS_CREATE_CHANNEL, (_event, name: unknown) => this.create(String(name)))
    ipcMain.handle(FOLDERS_RENAME_CHANNEL, (_event, id: unknown, name: unknown) =>
      this.rename(String(id), String(name))
    )
    ipcMain.handle(FOLDERS_DELETE_CHANNEL, (_event, id: unknown) => this.delete(String(id)))
  }

  list(): FolderRecord[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(raw) ? raw.filter(isFolderRecord) : []
    } catch {
      return [] // file doesn't exist yet (or is corrupt) — no folders
    }
  }

  create(name: string): FolderRecord {
    const folder: FolderRecord = {
      id: randomUUID(),
      name: cleanName(name),
      createdAt: new Date().toISOString()
    }
    this.save([...this.list(), folder])
    return folder
  }

  rename(id: string, name: string): FolderRecord | null {
    const folders = this.list()
    const folder = folders.find((f) => f.id === id)
    if (!folder) return null
    folder.name = cleanName(name)
    this.save(folders)
    return folder
  }

  delete(id: string): void {
    this.save(this.list().filter((f) => f.id !== id))
    // Sweep the meetings dir: anything filed here moves back to "My notes".
    // (Runs even if the folder was already gone, so orphans self-heal.)
    for (const meeting of this.meetings.list()) {
      if (meeting.folderId === id) {
        this.meetings.upsert({ id: meeting.id, folderId: null })
      }
    }
  }

  private save(folders: FolderRecord[]): void {
    writeFileSync(this.file, JSON.stringify(folders, null, 2))
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  if (trimmed.length === 0) throw new Error('Folder name is required')
  return trimmed
}

function isFolderRecord(value: unknown): value is FolderRecord {
  if (typeof value !== 'object' || value === null) return false
  const f = value as Partial<FolderRecord>
  return (
    typeof f.id === 'string' &&
    f.id.length > 0 &&
    typeof f.name === 'string' &&
    typeof f.createdAt === 'string'
  )
}
