import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BriefController } from './brief-controller'
import type { BriefApi, BriefView } from '../../../shared/briefs-api'
function fixture(): {
  api: Pick<BriefApi, 'onState' | 'open' | 'close' | 'cancel'>
  controller: BriefController
  states: Array<{ view: BriefView | null; busy: boolean; error: string | null }>
  closed: string[]
  emit(view: BriefView): void
  finishOpen(view: BriefView): void
} {
  let listener: (view: BriefView) => void = () => {}
  const closed: string[] = []
  let finishOpen!: (view: BriefView) => void
  const api: Pick<BriefApi, 'onState' | 'open' | 'close' | 'cancel'> = {
    cancel: async () => {},
    onState: (fn: typeof listener) => {
      listener = fn
      return () => {
        listener = () => {}
      }
    },
    open: () =>
      new Promise<BriefView>((r) => {
        finishOpen = r
      }),
    close: async (id: string) => {
      closed.push(id)
    }
  }
  const states: Array<{ view: BriefView | null; busy: boolean; error: string | null }> = []
  const controller = new BriefController(api, (state) => states.push(state))
  return {
    api,
    controller,
    states,
    closed,
    emit: (v: BriefView) => listener(v),
    finishOpen: (v: BriefView) => finishOpen(v)
  }
}
const ready: BriefView = { sessionId: 'one', state: 'review-ready', revision: 1 }
test('late open response cannot replace a newer unavailable push', async () => {
  const f = fixture()
  const opening = f.controller.open('event')
  f.emit(ready)
  f.emit({ sessionId: 'one', state: 'unavailable', message: 'Account removed' })
  f.finishOpen(ready)
  await opening
  assert.equal(f.states.at(-1)?.view?.state, 'unavailable')
  f.controller.dispose()
})
test('close during open releases its eventual session and cannot publish after unmount', async () => {
  const f = fixture()
  const opening = f.controller.open('event')
  f.controller.dispose()
  const count = f.states.length
  f.finishOpen(ready)
  await opening
  assert.deepEqual(f.closed, ['one'])
  assert.equal(f.states.length, count)
})
test('late command response cannot overwrite invalidation; stale auxiliary data is rejected', async () => {
  const f = fixture()
  const opening = f.controller.open('event')
  f.finishOpen(ready)
  await opening
  let release!: (view: BriefView) => void
  const command = f.controller.command(
    () =>
      new Promise<BriefView>((r) => {
        release = r
      })
  )
  f.emit({ sessionId: 'one', state: 'stale' })
  release(ready)
  await command
  assert.equal(f.states.at(-1)?.view?.state, 'stale')
  let readDone!: (value: string) => void
  const read = f.controller.read(
    () =>
      new Promise<string>((r) => {
        readDone = r
      })
  )
  f.emit({ sessionId: 'one', state: 'unavailable' })
  readDone('old candidate names')
  await assert.rejects(read, /changed/)
  f.controller.dispose()
})
