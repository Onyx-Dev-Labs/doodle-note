import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RecordingStartCoordinator, recordingMenuAction } from './recording-start-coordinator'
import type { RecordingStartRequest } from '../shared/recording-api'

const event = {
  action: 'start' as const,
  eventId: '',
  subject: 'Meeting',
  startIso: '2026-09-08T17:00:00Z'
}
function setup(): { coordinator: RecordingStartCoordinator; delivered: RecordingStartRequest[] } {
  const delivered: RecordingStartRequest[] = []
  const coordinator = new RecordingStartCoordinator(
    (r) => delivered.push(r),
    () => {}
  )
  return { coordinator, delivered }
}
test('menu requires completed setup, independently of calendars', () => {
  const { coordinator } = setup()
  assert.equal(recordingMenuAction(coordinator.snapshot()).enabled, false)
  assert.equal(coordinator.request(event), false)
  coordinator.ready(true)
  assert.deepEqual(recordingMenuAction(coordinator.snapshot()), {
    label: 'Record now',
    enabled: true
  })
})
test('closed-window start survives arbitrarily delayed renderer readiness exactly once', () => {
  const { coordinator: c, delivered } = setup()
  c.ready(true)
  c.rendererGone()
  assert.equal(c.request(event), true)
  assert.equal(c.request(event), false)
  assert.equal(delivered.length, 0)
  c.ready(false)
  assert.equal(delivered.length, 0)
  c.ready(true)
  c.ready(true)
  assert.equal(delivered.length, 1)
  assert.equal(c.attach(delivered[0]!.id, 'meeting-1'), true)
  assert.equal(c.attach(delivered[0]!.id, 'meeting-2'), false)
})
test('all starts serialize through preparation, permission wait, capture and finishing', () => {
  const { coordinator: c, delivered } = setup()
  c.ready(true)
  c.request(event)
  assert.equal(c.beginEngine('unrelated'), false)
  c.attach(delivered[0]!.id, 'meeting-1')
  assert.equal(c.beginEngine('unrelated'), false)
  assert.equal(c.beginEngine('meeting-1'), true)
  assert.equal(c.beginEngine('meeting-1'), false)
  assert.equal(c.request(event), false)
  assert.equal(recordingMenuAction(c.snapshot()).label, 'Starting…')
  c.handle({ event: 'ready' })
  assert.equal(recordingMenuAction(c.snapshot()).label, 'Recording…')
  c.stop()
  assert.equal(c.request(event), false)
  c.handle({ event: 'ready' })
  assert.equal(recordingMenuAction(c.snapshot()).label, 'Finishing…')
  c.handle({ event: 'done' })
  assert.equal(c.request(event), false, 'wait for engine exit, not just done')
  c.handle({ event: 'exit', code: 0, signal: null })
  assert.equal(c.request(event), true)
})
test('failed starts unlock; stale cancellation cannot release a later request', () => {
  const { coordinator: c, delivered } = setup()
  c.ready(true)
  c.request(event)
  const first = delivered[0]!.id
  c.cancel(first)
  c.request(event)
  c.cancel(first)
  assert.equal(c.busy, true)
  c.attach(delivered[1]!.id, 'meeting-2')
  c.beginEngine('meeting-2')
  c.handle({ event: 'spawn-error', message: 'engine unavailable' })
  assert.equal(c.busy, false)
  assert.equal(recordingMenuAction(c.snapshot()).label, 'Record now')
})
test('normal editor capture locks the tray and renderer loss waits for stopped engine', () => {
  const { coordinator: c } = setup()
  c.ready(true)
  assert.equal(c.beginEngine('manual'), true)
  assert.equal(c.request(event), false)
  c.stop()
  c.rendererGone()
  assert.equal(c.busy, true)
  c.handle({ event: 'exit', code: 1, signal: null })
  assert.equal(c.busy, false)
})
test('tray resources include transparent standard and Retina images with correct density', () => {
  for (const [name, size, ppm] of [
    ['dogTemplate.png', 22, 2835],
    ['dogTemplate@2x.png', 44, 5669],
    ['dogRecording.png', 22, 2835],
    ['dogRecording@2x.png', 44, 5669]
  ] as const) {
    const png = readFileSync(resolve('resources/tray', name))
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
    assert.equal(png[25], 6, 'RGBA retains template transparency')
    const densityOffset = png.indexOf(Buffer.from('pHYs'))
    assert.ok(densityOffset > 0)
    assert.equal(png.readUInt32BE(densityOffset + 4), ppm)
  }
  const config = readFileSync('electron-builder.yml', 'utf8')
  assert.match(config, /from: resources\/tray\s+to: tray\s+filter: \["\*\.png"\]/)
})

test('Record & Join opens once per accepted action across duplicate delivery and delayed renderer readiness', async () => {
  const delivered: RecordingStartRequest[] = []
  const opened: string[] = []
  const c = new RecordingStartCoordinator(
    (r) => delivered.push(r),
    () => {},
    async (url) => {
      opened.push(url)
    }
  )
  c.ready(true)
  c.rendererGone()
  const linked = {
    ...event,
    eventId: 'canonical-google-event',
    joinRequested: true,
    joinUrl: 'https://meet.google.com/aaa-bbbb-ccc'
  }
  assert.equal(c.request(linked), true)
  assert.equal(c.request(linked), false)
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(opened, [linked.joinUrl])
  assert.equal(c.snapshot().phase, 'requested', 'link launch is not capture success')
  assert.equal(delivered.length, 0)
  c.ready(true)
  c.ready(true)
  c.rendererGone()
  c.ready(true)
  assert.equal(new Set(delivered.map((r) => r.id)).size, 1)
  assert.equal(opened.length, 1)
  c.attach(delivered[0]!.id, 'existing-note')
  c.beginEngine('existing-note')
  assert.equal(c.snapshot().phase, 'starting')
  c.handle({ event: 'ready' })
  assert.equal(c.snapshot().phase, 'recording')
  c.stop()
  assert.equal(c.request(linked), false)
  assert.equal(opened.length, 1)
})

test('Join failure preserves recording and join-only retry cannot reserve capture or replay concurrent retry', async () => {
  const delivered: RecordingStartRequest[] = []
  let launches = 0,
    fail = true
  const c = new RecordingStartCoordinator(
    (r) => delivered.push(r),
    () => {},
    async () => {
      launches++
      if (fail) throw new Error('synthetic OS failure')
    }
  )
  c.ready(true)
  c.request({
    ...event,
    eventId: 'canonical-ms-event',
    joinRequested: true,
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/fixture'
  })
  const requestId = delivered[0]!.id
  c.attach(requestId, 'existing-note')
  c.beginEngine('existing-note')
  c.handle({ event: 'ready' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(c.snapshot().join?.status, 'failed')
  assert.equal(c.snapshot().phase, 'recording')
  await c.retryJoin('wrong-request')
  assert.equal(launches, 1)
  fail = false
  await Promise.all([c.retryJoin(requestId), c.retryJoin(requestId)])
  assert.equal(launches, 2)
  assert.equal(c.snapshot().join?.status, 'opened')
  assert.equal(c.snapshot().phase, 'recording')
  assert.equal(delivered.length, 1)
  c.handle({ event: 'spawn-error', message: 'synthetic capture failure' })
  assert.equal(c.snapshot().phase, 'idle')
  assert.equal(c.snapshot().join?.status, 'opened', 'capture failure cannot change link outcome')
})

test('standalone notes, unlinked detections and invalid URLs never launch; stale launch completion cannot replace a later state', async () => {
  const delivered: RecordingStartRequest[] = []
  let finish: () => void = () => {},
    launches = 0
  const c = new RecordingStartCoordinator(
    (r) => delivered.push(r),
    () => {},
    async () => {
      launches++
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    }
  )
  c.ready(true)
  for (const candidate of [
    { ...event, eventId: 'event', joinUrl: 'https://meet.google.com/aaa-bbbb-ccc' },
    { ...event, joinRequested: true, joinUrl: 'https://meet.google.com/aaa-bbbb-ccc' },
    {
      ...event,
      eventId: 'event',
      adHoc: true,
      joinRequested: true,
      joinUrl: 'https://meet.google.com/aaa-bbbb-ccc'
    },
    { ...event, eventId: 'event', joinRequested: true, joinUrl: 'javascript:alert(1)' }
  ]) {
    c.request(candidate)
    c.cancel(delivered.at(-1)!.id)
  }
  await Promise.resolve()
  assert.equal(launches, 0)
  c.request({
    ...event,
    eventId: 'event',
    joinRequested: true,
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/test'
  })
  await Promise.resolve()
  const first = delivered.at(-1)!.id
  c.cancel(first)
  c.request(event)
  finish()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(c.snapshot().join, undefined)
  assert.equal(c.snapshot().phase, 'requested')
})
