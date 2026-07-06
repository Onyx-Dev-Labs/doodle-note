import { ipcMain } from 'electron'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TranscriptSegment } from '../shared/engine-events'
import {
  MEETINGS_DELETE_CHANNEL,
  MEETINGS_GET_CHANNEL,
  MEETINGS_LIST_CHANNEL,
  MEETINGS_UPSERT_CHANNEL,
  type MeetingChatEntry,
  type MeetingRecord,
  type MeetingSummary,
  type MeetingUpsert
} from '../shared/meetings-api'

/** Meeting ids are renderer-minted UUIDs; anything else never touches disk. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

/**
 * Owns the meetings store: one JSON document per meeting under
 * userData/meetings/. The renderer drives all writes (debounced upserts of
 * the active meeting); this service just validates, merges and persists.
 */
export class MeetingsService {
  /**
   * Post-write hook (cloud sync): fires after any persisted change.
   * `deletedId` is set when a meeting was hard-deleted or moved to trash —
   * both mean its cloud copy (if any) should go away.
   */
  onDidWrite: ((change: { deletedId?: string }) => void) | null = null

  constructor(private readonly dir: string) {}

  registerIpc(): void {
    ipcMain.handle(MEETINGS_LIST_CHANNEL, () => this.list())
    ipcMain.handle(MEETINGS_GET_CHANNEL, (_event, id: unknown) => this.get(String(id)))
    ipcMain.handle(MEETINGS_UPSERT_CHANNEL, (_event, patch: unknown) =>
      this.upsert((patch ?? {}) as MeetingUpsert)
    )
    ipcMain.handle(MEETINGS_DELETE_CHANNEL, (_event, id: unknown) => this.delete(String(id)))
  }

  /* ---- queries ---- */

  list(): MeetingSummary[] {
    const summaries: MeetingSummary[] = []
    for (const file of this.listFiles()) {
      const record = this.readFile(file)
      if (!record) continue
      summaries.push({
        id: record.id,
        ...(record.kind === 'note' ? { kind: 'note' as const } : {}),
        title: record.title,
        createdAt: record.createdAt,
        ...(record.startedAt ? { startedAt: record.startedAt } : {}),
        ...(durationMinOf(record) !== undefined ? { durationMin: durationMinOf(record) } : {}),
        ...(record.folderId ? { folderId: record.folderId } : {}),
        ...(record.trashedAt ? { trashedAt: record.trashedAt } : {}),
        ...(record.calendarEventId ? { calendarEventId: record.calendarEventId } : {})
      })
    }
    // Newest first; createdAt is ISO so string compare sorts chronologically.
    summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return summaries
  }

  get(id: string): MeetingRecord | null {
    if (!SAFE_ID.test(id)) return null
    return this.readFile(`${id}.json`)
  }

  /**
   * Every stored meeting document, trashed ones included (callers filter).
   * Powers cross-meeting features in other services — e.g. NotesService
   * gathering context for the Home-level "ask anything".
   */
  readAll(): MeetingRecord[] {
    const records: MeetingRecord[] = []
    for (const file of this.listFiles()) {
      const record = this.readFile(file)
      if (record) records.push(record)
    }
    return records
  }

  /* ---- writes ---- */

  upsert(patch: MeetingUpsert): MeetingRecord {
    const id = typeof patch.id === 'string' ? patch.id : ''
    if (!SAFE_ID.test(id)) {
      throw new Error(`Invalid meeting id: ${JSON.stringify(patch.id)}`)
    }
    const existing = this.get(id)
    const merged = normalizeRecord({ ...(existing ?? {}), ...patch, id })
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(merged, null, 2))
    this.onDidWrite?.(merged.trashedAt ? { deletedId: id } : {})
    return merged
  }

  delete(id: string): void {
    if (!SAFE_ID.test(id)) return
    rmSync(join(this.dir, `${id}.json`), { force: true })
    this.onDidWrite?.({ deletedId: id })
  }

  /* ---- disk ---- */

  private listFiles(): string[] {
    try {
      return readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    } catch {
      return [] // dir doesn't exist yet — no meetings
    }
  }

  private readFile(name: string): MeetingRecord | null {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Partial<MeetingRecord>
      if (typeof raw.id !== 'string' || !SAFE_ID.test(raw.id)) return null
      return normalizeRecord(raw as MeetingUpsert)
    } catch {
      return null // unreadable/corrupt file — skip rather than crash the list
    }
  }
}

/** Fill defaults so every stored/returned record has the full shape. */
function normalizeRecord(raw: MeetingUpsert): MeetingRecord {
  return {
    id: raw.id,
    // Only "note" is stored; anything else normalizes to the meeting default.
    ...(raw.kind === 'note' ? { kind: 'note' as const } : {}),
    title: typeof raw.title === 'string' ? raw.title : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    ...(typeof raw.startedAt === 'string' ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.endedAt === 'string' ? { endedAt: raw.endedAt } : {}),
    rawNotesMarkdown: typeof raw.rawNotesMarkdown === 'string' ? raw.rawNotesMarkdown : '',
    ...(typeof raw.enhancedMarkdown === 'string' ? { enhancedMarkdown: raw.enhancedMarkdown } : {}),
    ...(typeof raw.engine === 'string' ? { engine: raw.engine } : {}),
    ...(typeof raw.templateId === 'string' && raw.templateId.length > 0
      ? { templateId: raw.templateId }
      : {}),
    segments: Array.isArray(raw.segments) ? (raw.segments as TranscriptSegment[]) : [],
    echoSuppressed: typeof raw.echoSuppressed === 'number' ? raw.echoSuppressed : 0,
    ...(Array.isArray(raw.chat) ? { chat: raw.chat.filter(isChatEntry) } : {}),
    // A null (or invalid) value drops the field — that's how "move back to
    // My notes" (folderId: null) and "restore from trash" (trashedAt: null)
    // clear state through the { ...existing, ...patch } merge above.
    ...(typeof raw.folderId === 'string' && raw.folderId.length > 0
      ? { folderId: raw.folderId }
      : {}),
    ...(isIsoString(raw.trashedAt) ? { trashedAt: raw.trashedAt } : {}),
    // Graph event ids are opaque and can be long — validate shape, cap length.
    ...(typeof raw.calendarEventId === 'string' &&
    raw.calendarEventId.length > 0 &&
    raw.calendarEventId.length <= 512
      ? { calendarEventId: raw.calendarEventId }
      : {})
  }
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isChatEntry(entry: unknown): entry is MeetingChatEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Partial<MeetingChatEntry>
  return (
    typeof e.question === 'string' && typeof e.answer === 'string' && typeof e.askedAt === 'string'
  )
}

function durationMinOf(record: MeetingRecord): number | undefined {
  if (record.startedAt && record.endedAt) {
    const ms = Date.parse(record.endedAt) - Date.parse(record.startedAt)
    if (Number.isFinite(ms) && ms > 0) return Math.max(1, Math.round(ms / 60_000))
  }
  if (record.segments.length > 0) {
    const ms = Math.max(...record.segments.map((s) => s.endMs))
    if (Number.isFinite(ms) && ms > 0) return Math.max(1, Math.round(ms / 60_000))
  }
  return undefined
}
