// DEV-508 research only. No production imports, devices, models or network.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LIMITS = Object.freeze({ frames: 16000, bytes: 32000, pendingPerSource: 4,
  recordsPerSource: 32, attempts: 2, deadlineMs: 200, maxWorkers: 2, maxSessions: 2 })
export const SOURCES = ['mic', 'system']

// A returned call proves these syscalls completed, not power-loss survival.
export function atomicJSON(path, value, boundary = () => {}) {
  const temporary = `${path}.tmp`
  let fd
  try {
    fd = openSync(temporary, 'w', 0o600)
    writeFileSync(fd, JSON.stringify(value))
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    boundary('file-synced')
    renameSync(temporary, path)
    boundary('renamed')
    fd = openSync(dirname(path), 'r')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    boundary('directory-synced')
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

export function readJournal(root) {
  try { return JSON.parse(readFileSync(join(root, 'commits.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { rows: {} }; throw error }
}

export class CaptureModel {
  constructor(root) {
    this.root = root
    this.pending = null
    this.session = null
    this.renderer = 0
    this.rejected = 0
    this.duplicates = 0
    this.peakPendingBytes = 0
    this.startedCaptures = new Set()
  }
  reserve(attemptId, meetingId) {
    if (this.pending || (this.session && this.session.phase !== 'ended')) return false
    this.pending = { attemptId, meetingId }
    return true
  }
  failStart(attemptId) {
    if (this.pending?.attemptId !== attemptId) return false
    this.pending = null
    return true // Previous session's immutable owner is untouched, even if empty.
  }
  start(attemptId, captureId) {
    if (this.pending?.attemptId !== attemptId) return false
    if (this.startedCaptures.has(captureId) || this.startedCaptures.size >= LIMITS.maxSessions) return false
    this.startedCaptures.add(captureId)
    this.session = { ...this.pending, captureId, phase: 'recording', worker: 1,
      sources: Object.fromEntries(SOURCES.map(source => [source, {
        captured: 0, transcribed: new Set(), committed: new Set(), gaps: new Set(),
        generation: 0, health: 'healthy', records: new Map(), attempts: new Map(), commitAttempts: 0
      }])) }
    this.pending = null
    return true
  }
  snapshot(meetingId) {
    if (this.session?.meetingId !== meetingId) return null
    return { meetingId, captureId: this.session.captureId, phase: this.session.phase }
  }
  token(source) {
    const s = this.session
    return { meetingId: s.meetingId, captureId: s.captureId, worker: s.worker,
      source, generation: s.sources[source].generation }
  }
  valid(token) {
    const s = this.session
    const valid = s && s.phase !== 'ended' && token.meetingId === s.meetingId &&
      token.captureId === s.captureId && token.worker === s.worker &&
      token.generation === s.sources[token.source]?.generation
    if (!valid) this.rejected++
    return valid
  }
  capture(source) {
    const s = this.session
    const state = s.sources[source]
    if (s.phase !== 'recording') return null
    const pending = [...state.records.keys()].filter(id => !state.committed.has(id))
    if (pending.length >= LIMITS.pendingPerSource || state.records.size >= LIMITS.recordsPerSource) {
      state.health = 'capacity-exhausted'
      this.stop(s.captureId)
      return null // No eviction and no claim that unadmitted future sound was captured.
    }
    const seq = state.captured / LIMITS.frames
    const id = `${s.captureId}-${source}-${seq}`
    const pcm = Buffer.alloc(LIMITS.bytes)
    for (let i = 0; i < LIMITS.frames; i++) pcm.writeInt16LE((i + seq) % 1024, i * 2)
    const path = join(this.root, `${id}.pcm`)
    const fd = openSync(path, 'wx', 0o600)
    try { writeFileSync(fd, pcm); fsyncSync(fd) } finally { closeSync(fd) }
    const record = { id, source, seq, start: state.captured, end: state.captured + LIMITS.frames,
      meetingId: s.meetingId, captureId: s.captureId, path }
    state.records.set(id, record)
    state.captured = record.end
    // Fixtures keep captured descriptors in memory; do not claim host recovery of this ledger.
    const bytes = SOURCES.reduce((total, ch) => total +
      [...s.sources[ch].records.keys()].filter(key => !s.sources[ch].committed.has(key)).length * LIMITS.bytes, 0)
    this.peakPendingBytes = Math.max(bytes, this.peakPendingBytes)
    return record
  }
  replay(source) {
    const state = this.session.sources[source]
    return [...state.records.values()].filter(record => {
      if (state.committed.has(record.id) || state.gaps.has(record.id)) return false
      try {
        if (readFileSync(record.path).length !== LIMITS.bytes) throw new Error('short chunk')
        return true
      } catch {
        state.gaps.add(record.id)
        state.health = 'audio-gap'
        return false
      }
    })
  }
  attempt(record) {
    const state = this.session.sources[record.source]
    const n = (state.attempts.get(record.id) ?? 0) + 1
    if (n > LIMITS.attempts) { state.health = 'retry-exhausted'; return false }
    state.attempts.set(record.id, n)
    return true
  }
  accept(token, record, text) {
    if (!this.valid(token)) return false
    const state = this.session.sources[token.source]
    const known = state.records.get(record.id)
    if (!known || known.source !== token.source || known.captureId !== token.captureId ||
      known.meetingId !== token.meetingId) { this.rejected++; return false }
    state.transcribed.add(record.id)
    known.text = text.slice(0, 256)
    return true
  }
  commit(source, boundary) {
    const state = this.session.sources[source]
    if (state.commitAttempts >= LIMITS.attempts) {
      state.health = 'storage-retry-exhausted'
      this.stop(this.session.captureId)
      throw new Error('storage retry budget exhausted')
    }
    state.commitAttempts++
    const journal = readJournal(this.root)
    for (const id of state.transcribed) {
      const record = state.records.get(id)
      if (journal.rows[id]) { this.duplicates++; continue }
      journal.rows[id] = { id, meetingId: record.meetingId, captureId: record.captureId,
        source, start: record.start, end: record.end, text: record.text, revision: 0 }
    }
    // No committed watermark or retention release until all requested syncs return.
    atomicJSON(join(this.root, 'commits.json'), journal, boundary)
    state.commitAttempts = 0
    for (const id of state.transcribed) state.committed.add(id)
    for (const id of state.committed) rmSync(state.records.get(id).path, { force: true })
  }
  edit(id, text, expectedRevision) {
    const journal = readJournal(this.root)
    const row = journal.rows[id]
    if (!row || row.revision !== expectedRevision || text.length > 256) return false
    row.text = text
    row.revision++
    row.manual = true
    atomicJSON(join(this.root, 'commits.json'), journal)
    return true
  }
  replaceRenderer() { return ++this.renderer } // Subscription only; no capture/start side effect.
  switchDevice(source) {
    const state = this.session.sources[source]
    state.generation++
    state.health = 'device-changing'
  }
  restartWorker() {
    if (this.session.worker >= LIMITS.maxWorkers) return false
    this.session.worker++
    return true
  }
  stop(captureId) {
    if (!this.session || this.session.captureId !== captureId || this.session.phase === 'ended') return false
    this.session.phase = 'stopping'
    return true
  }
  terminal(token) {
    if (!this.valid(token)) return false
    this.session.phase = 'ended'
    return true
  }
  coverage(source) {
    const state = this.session.sources[source]
    const rows = Object.values(readJournal(this.root).rows).filter(row =>
      row.captureId === this.session.captureId && row.source === source)
    const positions = new Set(rows.map(row => row.start))
    let contiguous = 0
    while (positions.has(contiguous)) contiguous += LIMITS.frames
    return { capturedFrames: state.captured, transcribedIds: [...state.transcribed],
      committedIds: rows.map(row => row.id), committedFrames: rows.length * LIMITS.frames,
      committedContiguousFrames: contiguous, gapIds: [...state.gaps],
      missingTranscriptFrames: state.captured - rows.length * LIMITS.frames,
      duplicateRows: rows.length - new Set(rows.map(row => row.id)).size }
  }
}
