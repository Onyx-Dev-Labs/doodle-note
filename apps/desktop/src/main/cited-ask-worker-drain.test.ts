import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { SourceIndexClient } from '@repo/meetings-store/source-index-client'
import { localSourceScope } from '@repo/meetings-store/sources'
import { MainCitedAskService } from './cited-ask-service'
import { LibraryActivity } from './library-activity'

const require = createRequire(import.meta.url)
const tick = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 60))
for (const ending of ['reply', 'exit', 'failure', 'invalidate'] as const) {
  test(
    `blocked original resolution retains cited producer and transfer barrier until worker ${ending}`,
    { timeout: 10000 },
    async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'cited-drain-'))
      const dir = join(root, 'originals')
      mkdirSync(dir)
      const file = join(dir, 'meeting.json')
      writeFileSync(
        file,
        JSON.stringify({ id: 'meeting', rawNotesMarkdown: 'Orchid ships Friday.' })
      )
      const context = { meetingsDir: dir, scope: localSourceScope(dir, true), authorized: true }
      const shared = new SharedArrayBuffer(8)
      const flags = new Int32Array(shared)
      // Block the real worker's original read only after retrieval/manifest validation.
      const worker = new Worker(
        `
      const {workerData,parentPort}=require('node:worker_threads');
      const fs=require('node:fs');const flags=new Int32Array(workerData.probeShared);
      const read=fs.readFileSync;
      fs.readFileSync=function(path,...args){
        if(String(path)===workerData.probeFile && Atomics.compareExchange(flags,0,1,2)===1){
          parentPort.postMessage({probeStarted:true});Atomics.wait(flags,1,0);
          if(workerData.ending==='exit')process.exit(7);
          if(workerData.ending==='failure'){parentPort.postMessage=()=>{};process.nextTick(()=>{throw new Error('synthetic worker failure')});}
        }
        return read.call(this,path,...args);
      };
      require(${JSON.stringify(require.resolve('tsx/cjs'))});
      require(${JSON.stringify(require.resolve('@repo/meetings-store/source-index-worker'))});
    `,
        {
          eval: true,
          workerData: {
            meetingsDir: dir,
            cacheDir: join(root, 'cache'),
            probeShared: shared,
            probeFile: file,
            ending
          }
        }
      )
      let exited = false
      worker.on('exit', () => {
        exited = true
      })
      const client = new SourceIndexClient(worker, () => context)
      t.after(async () => {
        Atomics.store(flags, 1, 1)
        Atomics.notify(flags, 1)
        await client.close()
        rmSync(root, { recursive: true, force: true })
      })
      const began = new Promise<void>((resolve) =>
        worker.on('message', (m) => {
          if (m.probeStarted) resolve()
        })
      )
      const activity = new LibraryActivity()
      let generations = 0
      const service = new MainCitedAskService({
        activity,
        sources: {
          retrieveEvidence: (s, signal) => client.retrieveEvidence(s, signal),
          validateEvidence: (m, signal) => client.validateEvidence(m, signal),
          resolveAcknowledged: (a, signal) => {
            Atomics.store(flags, 0, 1)
            return client.resolveAcknowledged(a, signal)
          }
        },
        validateModel: async () => true,
        generate: async () => {
          generations++
          throw new Error('must not generate')
        }
      })
      const request = {
        purpose: 'library-ask' as const,
        selection: { mode: 'question' as const, question: 'Orchid', filters: {} }
      }
      const control = {
        ownerId: 'owner',
        runId: 'run',
        signal: new AbortController().signal,
        assertCurrent: () => {}
      }
      const run = service.run(request, control)
      await began
      let cancelled = false
      let transferred = false
      const cancel = service.cancel('owner', 'run').then(() => {
        cancelled = true
      })
      if (ending === 'invalidate') client.invalidate()
      const exclusive = activity.exclusive(async () => {
        transferred = true
      })
      await tick()
      assert.equal(cancelled, false, 'cancel must retain producer until real worker acknowledges')
      assert.equal(transferred, false, 'library must remain pinned during blocked original read')
      const retry = await service.run(request, { ...control, runId: 'retry' })
      assert.equal(retry.status, 'error')
      if (retry.status === 'error') assert.equal(retry.code, 'busy')
      Atomics.store(flags, 1, 1)
      Atomics.notify(flags, 1)
      await cancel
      await exclusive
      if (ending === 'exit' || ending === 'failure')
        assert.equal(exited, true, 'worker exit acknowledgement precedes release')
      const result = await run
      assert.equal(result.status, 'error')
      if (result.status === 'error') assert.equal(result.code, 'cancelled')
      assert.equal(generations, 0)
      assert.equal(transferred, true)
      // Duplicate/late replies cannot revive the cancelled producer or publish a result.
      worker.emit('message', { id: 3, result: { status: 'resolved', passage: { text: 'late' } } })
      assert.equal(generations, 0)
    }
  )
}
