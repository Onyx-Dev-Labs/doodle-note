import { readEdits, type LearnedPair } from '../shared/dictation-dictionary'
import type { FieldReading } from '../shared/dictation-helper-protocol'

export interface LearnerDeps {
  read(watchId: string): Promise<FieldReading>
  /** Release the helper's handle on the field. */
  stop(watchId: string): void
  now(): number
  /** Called once per watch, with corrections that look like fixes of misheard words. */
  onLearn(pairs: LearnedPair[]): void
  /** Run `tick` every `ms` until the returned function is called. */
  every(ms: number, tick: () => void): () => void
}

export const LEARNER_POLL_MS = 1_000
/** Long enough to edit and send a message. */
export const LEARNER_MAX_MS = 180_000
/** The text was never seen in the field: it was not typed there after all. */
export const LEARNER_NOT_SEEN_MS = 10_000
/** The person moved on without sending; what is there now is what they meant. */
export const LEARNER_UNFOCUSED_MS = 15_000
const MAX_UNREADABLE = 3

interface Watch {
  id: string
  /** What was typed. Held in memory only, until the watch ends. */
  inserted: string
  startedAt: number
  lastValue: string | null
  /** Corrections from the latest reading in which the typed words were still there. */
  pairs: LearnedPair[]
  found: boolean
  unfocusedSince: number | null
  unreadable: number
  reading: boolean
  cancel: () => void
}

/**
 * Watches the one field the last dictation was typed into. While you fix a
 * misheard word and send, the field is read back about once a second; when the
 * message goes (the field is cleared or disappears), you move away, or time runs
 * out, whatever you had corrected by then is reported. The field's text is
 * compared in memory and dropped: nothing is stored or logged, and only the
 * changed words that look like a misheard word are ever passed on.
 */
export class DictationLearner {
  private watch: Watch | null = null

  constructor(private readonly deps: LearnerDeps) {}

  get watching(): boolean {
    return this.watch !== null
  }

  /** Begin watching a field the text was just typed into; ends and reports any earlier watch first. */
  start(watchId: string, inserted: string): void {
    this.finish()
    const watch: Watch = {
      id: watchId,
      inserted,
      startedAt: this.deps.now(),
      lastValue: null,
      pairs: [],
      found: false,
      unfocusedSince: null,
      unreadable: 0,
      reading: false,
      cancel: () => {}
    }
    watch.cancel = this.deps.every(LEARNER_POLL_MS, () => void this.tick())
    this.watch = watch
  }

  /** One read-back. Public so tests can drive it without timers. */
  async tick(): Promise<void> {
    const watch = this.watch
    if (!watch || watch.reading) return
    watch.reading = true
    let reading: FieldReading
    try {
      reading = await this.deps.read(watch.id)
    } catch {
      reading = { state: 'unreadable' }
    }
    watch.reading = false
    if (this.watch !== watch) return
    const now = this.deps.now()
    switch (reading.state) {
      case 'secure':
      case 'too-long':
        // Never learn from a password field or a document-sized one.
        this.discard()
        return
      case 'gone':
        this.finish()
        return
      case 'unreadable':
        watch.unreadable += 1
        if (watch.unreadable >= MAX_UNREADABLE) this.finish()
        return
      case 'ok':
        break
    }
    if (reading.state !== 'ok') return
    watch.unreadable = 0
    if (reading.value !== watch.lastValue) {
      watch.lastValue = reading.value
      const edits = readEdits(watch.inserted, reading.value)
      if (edits.found) {
        watch.found = true
        watch.pairs = edits.pairs
      } else if (watch.found) {
        // The typed words are gone: the message was sent, cleared or replaced.
        this.finish()
        return
      } else if (now - watch.startedAt > LEARNER_NOT_SEEN_MS) {
        this.discard()
        return
      }
    }
    if (reading.focused) watch.unfocusedSince = null
    else watch.unfocusedSince ??= now
    if (watch.unfocusedSince !== null && now - watch.unfocusedSince > LEARNER_UNFOCUSED_MS) {
      this.finish()
      return
    }
    if (now - watch.startedAt > LEARNER_MAX_MS) this.finish()
  }

  /** End the watch and report what was corrected. */
  finish(): void {
    const watch = this.end()
    if (watch && watch.found && watch.pairs.length > 0) this.deps.onLearn(watch.pairs)
  }

  /** End the watch and learn nothing. */
  discard(): void {
    this.end()
  }

  private end(): Watch | null {
    const watch = this.watch
    if (!watch) return null
    this.watch = null
    watch.cancel()
    this.deps.stop(watch.id)
    // Drop the text at once; only the corrections survive, in the return value.
    const pairs = watch.pairs
    watch.inserted = ''
    watch.lastValue = null
    watch.pairs = []
    return { ...watch, pairs }
  }
}
