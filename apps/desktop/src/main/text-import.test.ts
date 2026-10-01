import { beginRecordableMeeting } from './capture-eligibility'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MeetingFileStore, durationMinOf, spokenSegments } from '@repo/meetings-store'
import { formatTranscript } from '@repo/ai'
import { parseTextTranscript, MAX_TEXT_IMPORT_BYTES } from './text-import-logic'
import { buildExportMarkdown } from './export-logic'
import { supportsCloudSync } from './sync-content-hash'

let picked: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const original = loader._load
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        BrowserWindow: { getAllWindows: () => [{}] },
        dialog: { showOpenDialog: async () => picked },
        ipcMain: {
          handle: (name: string, callback: (...args: unknown[]) => unknown) =>
            handlers.set(name, callback)
        }
      }
    : original(id, ...args)
const { TextImportService } =
  require('./text-import-service') as typeof import('./text-import-service')
loader._load = original

const parse = (text: string): ReturnType<typeof parseTextTranscript> =>
  parseTextTranscript(Buffer.from(text))

test('plain UTF-8 paragraphs preserve Unicode, whitespace and neutral identity without invented timing', () => {
  const text = 'A café planning note.\n\n  A second paragraph.\n'
  const [segment] = parse('\uFEFF' + text.replaceAll('\n', '\r\n'))
  assert.equal(segment!.text, text)
  assert.equal(segment!.speaker, 'Speaker')
  assert.equal(segment!.speakerId, 'text-unknown')
  assert.equal(segment!.channel, 'text')
  for (const key of ['startMs', 'endMs', 'absoluteStartMs', 'confidence'])
    assert.equal(key in segment!, false)
})

test('speaker sections retain order, repeated identities and unrecognized labels', () => {
  const segments = parse(
    '[Speaker 1]\nFirst.\n\n[Speaker 2]\nSecond.\n[Custom label]\nKeep this.\n[Speaker 1]\nLast.'
  )
  assert.deepEqual(
    segments.map((s) => s.speaker),
    ['Speaker 1', 'Speaker 2', 'Speaker 1']
  )
  assert.equal(segments[0]!.speakerId, segments[2]!.speakerId)
  assert.equal(segments[1]!.text, 'Second.\n[Custom label]\nKeep this.')
  assert.notEqual(segments[0]!.id, segments[2]!.id)
})

test('invalid, empty, unsupported and oversized text fails before persistence', () => {
  assert.throws(() => parse('  \n'), /empty/)
  assert.throws(() => parse('[Speaker 1]\n'), /no text/)
  assert.throws(() => parse('hello\u0000world'), /binary/)
  assert.throws(() => parseTextTranscript(Uint8Array.from([0xff, 0xfe, 0x61, 0])), /UTF-8/)
  assert.throws(() => parseTextTranscript(Uint8Array.from([0xc3, 0x28])), /UTF-8/)
  assert.throws(() => parseTextTranscript(new Uint8Array(MAX_TEXT_IMPORT_BYTES + 1)), /too large/)
})

test('preview, cancel, owner binding and single-use commit through library IPC preserve the original', async () => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-text-import-'))
  try {
    const file = join(root, 'Synthetic transcript.txt')
    writeFileSync(file, '[Speaker 1]\nPlan a synthetic garden.\n[Speaker 2]\nAdd a bench.')
    let library = join(root, 'old', 'meetings')
    const store = new MeetingFileStore(() => library)
    const service = new TextImportService(store)
    service.registerIpc()
    picked = { canceled: false, filePaths: [file] }
    const preview = (await service.preview(7)).preview!
    assert.ok(preview)
    assert.equal(store.list().length, 0)
    assert.match(service.commit(8, preview.token).error!, /expired/)
    await handlers.get('text-import:cancel')!({ sender: { id: 7 } }, preview.token)
    assert.match(service.commit(7, preview.token).error!, /expired/)
    assert.equal(store.list().length, 0)
    const second = (await service.preview(7)).preview!
    // Moving the library while the preview is open uses the current root on commit.
    library = join(root, 'new', 'meetings')
    writeFileSync(file, 'Changed outside the app after preview.')
    const committed = (await handlers.get('text-import:commit')!(
      { sender: { id: 7 } },
      second.token
    )) as { meetingId: string }
    const record = store.get(committed.meetingId)!
    assert.equal(record.segments[0]!.text, 'Plan a synthetic garden.')
    assert.equal(record.startedAt, undefined)
    assert.equal(durationMinOf(record), undefined)
    assert.equal(service.commit(7, second.token).meetingId, undefined)
    assert.equal(store.list().length, 1)
    assert.deepEqual(readdirSync(library), [`${record.id}.json`])
    assert.equal(store.search('bench')[0]!.field, 'transcript')
    assert.deepEqual(
      spokenSegments(record).map((s) => s.speaker),
      ['Speaker 1', 'Speaker 2']
    )
    assert.match(buildExportMarkdown(record), /Speaker 2:\*\* Add a bench\./)
    assert.doesNotMatch(buildExportMarkdown(record), /\[0:00\]|NaN/)
    assert.equal(
      formatTranscript(record.segments),
      'Speaker 1: Plan a synthetic garden.\nSpeaker 2: Add a bench.'
    )
    assert.equal(supportsCloudSync(record), false)
    assert.equal(supportsCloudSync({ ...record, segments: [] }), true)
    const moved = join(root, 'relocated', 'meetings')
    cpSync(library, moved, { recursive: true })
    assert.deepEqual(new MeetingFileStore(moved).get(record.id), record)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('picker cancel, unreadable and invalid files create no records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-text-reject-'))
  try {
    const store = new MeetingFileStore(join(root, 'meetings'))
    const service = new TextImportService(store)
    picked = { canceled: true, filePaths: [] }
    assert.equal((await service.preview(1)).canceled, true)
    picked = { canceled: false, filePaths: [join(root, 'missing.txt')] }
    assert.match((await service.preview(1)).error!, /Could not read/)
    const file = join(root, 'empty.txt')
    writeFileSync(file, '')
    picked = { canceled: false, filePaths: [file] }
    assert.match((await service.preview(1)).error!, /empty/)
    assert.equal(store.list().length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a save failure retains the preview for retry and never modifies an existing meeting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-text-retry-'))
  try {
    let available = true
    const store = new MeetingFileStore(join(root, 'meetings'), () => {
      if (!available) throw new Error('Fixture library unavailable')
    })
    const original = store.upsert({
      id: 'existing',
      title: 'Keep this',
      rawNotesMarkdown: 'Original notes',
      segments: []
    })
    const file = join(root, 'retry.txt')
    writeFileSync(file, 'Synthetic retry content.')
    picked = { canceled: false, filePaths: [file] }
    const service = new TextImportService(store)
    const preview = (await service.preview(1)).preview!
    available = false
    assert.match(service.commit(1, preview.token).error!, /Could not save/)
    available = true
    assert.equal(store.list().length, 1)
    const result = service.commit(1, preview.token)
    assert.ok(result.meetingId)
    assert.equal(store.list().length, 2)
    assert.deepEqual(store.get('existing'), original)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cloud queue skips text imports while retaining ordinary records and rejects text sharing locally', async () => {
  const root = mkdtempSync(join(tmpdir(), 'doodle-text-sync-'))
  try {
    // Same Electron fixture as above, with storage stub for the sync constructor.
    loader._load = (id, ...args) =>
      id === 'electron'
        ? {
            ipcMain: {},
            shell: {},
            safeStorage: { isEncryptionAvailable: () => false }
          }
        : original(id, ...args)
    const { SyncService } = require('./sync-service') as typeof import('./sync-service')
    loader._load = original
    const store = new MeetingFileStore(join(root, 'meetings'))
    store.upsert({ id: 'text-only', title: 'Text', segments: parse('Synthetic private text.') })
    store.upsert({ id: 'regular', title: 'Ordinary note' })
    const service = new SyncService(root, store as never, {} as never, () => {})
    const access = service as unknown as {
      pendingMeetings(): Array<{ id: string }>
      token(): string
    }
    assert.deepEqual(
      access.pendingMeetings().map((r) => r.id),
      ['regular']
    )
    access.token = () => 'synthetic-local-test'
    const result = await service.share('text-only')
    assert.ok('error' in result && result.error.includes('stay on this computer'))
  } finally {
    loader._load = original
    rmSync(root, { recursive: true, force: true })
  }
})

test('text imports reject capture before reserving the recording coordinator', () => {
  let begins = 0
  let message = ''
  const begin = (): boolean => {
    begins++
    return true
  }
  const reject = (error: string): void => {
    message = error
  }
  const record = {
    id: 'text',
    title: 'Text',
    createdAt: '2026-10-01',
    rawNotesMarkdown: '',
    echoSuppressed: 0,
    segments: parse('Synthetic text.')
  }
  assert.equal(beginRecordableMeeting(record, begin, reject), false)
  assert.equal(begins, 0)
  assert.match(message, /Create a new meeting/)
  assert.equal(beginRecordableMeeting({ ...record, segments: [] }, begin, reject), true)
  assert.equal(begins, 1)
})
