/** Synthetic read+atomic-write probe. No app/profile/provider/model/hardware access. */
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { localSourceScope } from '@repo/meetings-store/sources'
import {
  CalendarContextStore,
  CONTEXT_FILE,
  CONTEXT_MAX_BYTES
} from '../src/main/calendar-context-store'
import { denseCalendarContext } from '../src/main/test-fixtures/calendar-context'
import { LibraryActivity } from '../src/main/library-activity'

const percentile = (values: number[], p: number): number =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!
async function main(): Promise<void> {
  for (const count of [600, 3000, 6000, 10000]) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-dense-perf-')))
    mkdirSync(join(root, 'meetings'))
    const scope = localSourceScope(join(root, 'meetings'), true)
    const store = new CalendarContextStore(
      () => root,
      () => {},
      new LibraryActivity()
    )
    try {
      const fixture = denseCalendarContext(scope, count)
      const bytes = Buffer.byteLength(JSON.stringify(fixture))
      if (bytes > CONTEXT_MAX_BYTES) throw new Error('Fixture exceeds admission bound')
      writeFileSync(join(root, CONTEXT_FILE), JSON.stringify(fixture))
      const control = { assertCurrent: () => {} }
      await store.read(control)
      const readMs: number[] = [],
        writeMs: number[] = [],
        loopMs: number[] = []
      let last = performance.now()
      const heartbeat = setInterval(() => {
        const now = performance.now()
        loopMs.push(now - last)
        last = now
      }, 1)
      try {
        for (let i = 0; i < 20; i++) {
          const before = performance.now()
          const data = await store.read(control)
          readMs.push(performance.now() - before)
          const writing = performance.now()
          await store.createEntity(
            'person',
            Object.values(data.snapshots)[0]!.accountId,
            `Synthetic person ${i}`,
            data.revision,
            control
          )
          writeMs.push(performance.now() - writing)
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      } finally {
        clearInterval(heartbeat)
      }
      console.log(
        JSON.stringify({
          count,
          bytes,
          iterations: 20,
          readP95Ms: percentile(readMs, 0.95),
          writeP95Ms: percentile(writeMs, 0.95),
          loopP95Ms: percentile(loopMs, 0.95),
          loopMaxMs: Math.max(...loopMs),
          loopSamples: loopMs.length,
          node: process.version,
          platform: process.platform,
          arch: process.arch
        })
      )
    } finally {
      await store.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
