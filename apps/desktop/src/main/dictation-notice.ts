/**
 * Round 28 (Astra, the coordinator): the clipboard NOTICE SLOT and the user's Restore requests, modelled once as a
 * small pure reducer instead of ordering patches. The service owns one slot, separate from the offer card; the
 * overlay shows the slot's notice while one is current, and nothing else writes over it.
 *
 * The rules (each has its own unit test in dictation-notice.test.ts):
 * (a) a Restore request completes EXACTLY ONCE, by whichever of its recovered event or its reply comes first; the
 *     other is consumed. A request whose reply was "failed" (no answer in time) completes by its later event. A
 *     completion with something to say SETS the slot. A further click while a request is pending is ignored.
 * (b) a later ACCEPTED user interaction with the current UI (Dismiss of any card; a click on the card shown; a new
 *     dictation, meaning a start accepted after its prerequisite checks and the capture ownership; a transform)
 *     SUPERSEDES the slot: that notice is gone for good; no path shows it again (only a NEW completion or report sets
 *     the slot). A stale click naming a withdrawn card is rejected before it reaches here and supersedes nothing.
 * (c) offer-gone and offer-added, for any record, and every offer-list refresh never change the slot (they are not
 *     events of this reducer at all).
 * (d) a newer completion or report replaces an older notice.
 * (e) the slot's notice is what the overlay displays while it is current, EXCEPT that a live session, a recovery
 *     card and an error or status notice keep their priority over it. It ends only by (b), (d), its own expiry (the
 *     notice that set the timer, by id; the six-second timer starts when the notice is set, so a completion that
 *     arrives during a recording can expire while hidden and never be seen), or, for a delivery's own report only,
 *     withdraw-report (its late result says the report is no longer true).
 */
import type { ClipboardProblem } from './dictation-overlay-view'

/** A clipboard notice as the overlay shows it. */
export interface ClipboardNotice {
  kind: 'clipboard'
  problem: ClipboardProblem
  missing?: string[]
  reason?: string
  delivered?: boolean
}

export interface RestoreRequest {
  /** Sent, and its reply has not come yet (the card shows "Restoring…"; another click is ignored). */
  pending: boolean
  /** Its result was reported (by its event or its reply): the other one is consumed. */
  completed: boolean
}

export interface NoticeState {
  /** The notice the overlay shows now, with its id (each notice set gets a new one), or null. */
  current: { id: number; notice: ClipboardNotice; record: string | null } | null
  nextId: number
  /** The newest Restore request per record. */
  requests: ReadonlyMap<string, RestoreRequest>
}

export type NoticeEvent =
  /** The user clicked Restore on a record's card. */
  | { type: 'request'; record: string }
  /** The helper's recovered event for a record (its Restore completed): `notice` is what to say, if anything. */
  | { type: 'recovered'; record: string; notice: ClipboardNotice | null }
  /**
   * The reply to a record's Restore request. completed: the Restore ran (restored, partial, skipped,
   * restored-partially); failed: no answer in time (the Restore may still finish: its event completes it);
   * other: it did not run (busy, changed, incomplete, nothing-to-restore, gone).
   */
  | {
      type: 'reply'
      record: string
      outcome: 'completed' | 'failed' | 'other'
      notice: ClipboardNotice | null
    }
  /** A delivery's own clipboard report (not a Restore): a new notice (rule d). */
  | { type: 'report'; notice: ClipboardNotice }
  /** A later user interaction (rule b). */
  | { type: 'supersede' }
  /** A delivery's late result says its own notice is no longer true: it goes (a Restore's notice is not touched). */
  | { type: 'withdraw-report' }
  /** The timer of notice `id` ran out. */
  | { type: 'expire'; id: number }

export const initialNoticeState = (): NoticeState => ({
  current: null,
  nextId: 1,
  requests: new Map()
})

/** How many requests are remembered (the newest per record; the oldest records are forgotten first). */
const MAX_REQUESTS = 20

export interface NoticeStep {
  state: NoticeState
  /** The event was ignored (a click while that record's request is pending). */
  ignored?: boolean
  /** The event was a Restore result this reducer consumed (a request existed for its record). */
  handled?: boolean
  /** A notice was set (a new id): the service starts its timer and counts it once. */
  shown?: { id: number; notice: ClipboardNotice }
}

function show(state: NoticeState, notice: ClipboardNotice, record: string | null): NoticeStep {
  const id = state.nextId
  return {
    state: { ...state, current: { id, notice, record }, nextId: id + 1 },
    shown: { id, notice }
  }
}

function withRequest(
  state: NoticeState,
  record: string,
  request: RestoreRequest | null
): NoticeState {
  const requests = new Map(state.requests)
  requests.delete(record)
  if (request) requests.set(record, request)
  while (requests.size > MAX_REQUESTS) requests.delete(requests.keys().next().value as string)
  return { ...state, requests }
}

export function reduceNotice(state: NoticeState, event: NoticeEvent): NoticeStep {
  switch (event.type) {
    case 'request': {
      if (state.requests.get(event.record)?.pending) return { state, ignored: true }
      return { state: withRequest(state, event.record, { pending: true, completed: false }) }
    }
    case 'recovered': {
      const request = state.requests.get(event.record)
      if (!request) return { state }
      if (request.completed) return { state, handled: true }
      const next = withRequest(state, event.record, { ...request, completed: true })
      return event.notice
        ? { ...show(next, event.notice, event.record), handled: true }
        : { state: next, handled: true }
    }
    case 'reply': {
      const request = state.requests.get(event.record)
      if (!request) return { state, handled: true }
      if (event.outcome === 'failed')
        return {
          state: withRequest(state, event.record, { ...request, pending: false }),
          handled: true
        }
      if (event.outcome === 'other')
        return {
          state: withRequest(
            state,
            event.record,
            request.completed ? { ...request, pending: false } : null
          ),
          handled: true
        }
      // completed
      const next = withRequest(state, event.record, { pending: false, completed: true })
      if (request.completed || !event.notice) return { state: next, handled: true }
      return { ...show(next, event.notice, event.record), handled: true }
    }
    case 'report':
      return show(state, event.notice, null)
    case 'supersede':
      return state.current ? { state: { ...state, current: null } } : { state }
    case 'withdraw-report':
      return state.current && state.current.record === null
        ? { state: { ...state, current: null } }
        : { state }
    case 'expire':
      return state.current?.id === event.id ? { state: { ...state, current: null } } : { state }
  }
}

/** A record's Restore is pending (sent, no reply yet). */
export const restorePending = (state: NoticeState, record: string): boolean =>
  state.requests.get(record)?.pending === true
