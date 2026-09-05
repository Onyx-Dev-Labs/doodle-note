import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UpdateCoordinator } from './update-coordinator'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('stalled downloads cancel, preserve a readable error, and allow a successful retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let download = deferred<string[]>()
  let cancelled = 0
  const token = {
    cancel() {
      cancelled++
      download.reject(new Error('cancelled with private path'))
    }
  }
  const updater = {
    checkForUpdates: async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '0.4.22' },
      cancellationToken: token
    }),
    downloadUpdate: () => download.promise
  }
  const controller = new UpdateCoordinator(updater, '0.4.21', true, () => {}, 100)
  await controller.check()
  assert.equal(controller.state.status, 'downloading')
  t.mock.timers.tick(101)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(cancelled, 1)
  assert.equal(controller.state.status, 'error')
  assert.doesNotMatch(controller.state.error!, /private path/)
  download = deferred<string[]>()
  await controller.check()
  controller.progress({ percent: 50, transferred: 100 })
  download.resolve(['installer.exe'])
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(controller.state.status, 'downloaded')
  assert.equal(controller.state.percent, 100)
})

test('cancelled downloads ignore late progress and completion', async () => {
  const download = deferred<string[]>()
  const controller = new UpdateCoordinator(
    {
      checkForUpdates: async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '0.4.22' },
        cancellationToken: {
          cancel() {
            /* Simulate a transport that finishes after cancellation. */
          }
        }
      }),
      downloadUpdate: () => download.promise
    },
    '0.4.21',
    true,
    () => {}
  )
  await controller.check()
  controller.cancel()
  controller.progress({ percent: 99, transferred: 999 })
  download.resolve(['installer.exe'])
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(controller.state.status, 'cancelled')
})

test('only actual byte progress extends the download deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const download = deferred<string[]>()
  const controller = new UpdateCoordinator(
    {
      checkForUpdates: async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '0.4.22' },
        cancellationToken: {
          cancel() {
            download.reject(new Error('cancelled'))
          }
        }
      }),
      downloadUpdate: () => download.promise
    },
    '0.4.21',
    true,
    () => {},
    100
  )
  await controller.check()
  t.mock.timers.tick(90)
  controller.progress({ percent: 10, transferred: 100 })
  t.mock.timers.tick(90)
  assert.equal(controller.state.status, 'downloading')
  controller.progress({ percent: 10, transferred: 100 })
  t.mock.timers.tick(11)
  assert.equal(controller.state.status, 'error')
  await new Promise<void>((resolve) => setImmediate(resolve))
})

test('a timed-out metadata request cannot overwrite a newer check', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const old = deferred<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>()
  let calls = 0
  const controller = new UpdateCoordinator(
    {
      checkForUpdates: () =>
        ++calls === 1
          ? old.promise
          : Promise.resolve({ isUpdateAvailable: false, updateInfo: { version: '0.4.21' } }),
      downloadUpdate: async () => []
    },
    '0.4.21',
    true,
    () => {},
    100
  )
  const checking = controller.check()
  t.mock.timers.tick(101)
  await checking
  assert.equal(controller.state.status, 'error')
  await controller.check()
  old.resolve({ isUpdateAvailable: true, updateInfo: { version: '0.4.22' } })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(controller.state.status, 'up-to-date')
  assert.equal(controller.state.latestVersion, undefined)
})
