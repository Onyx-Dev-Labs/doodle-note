import { createServer as createViteServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const qaRoot = dirname(fileURLToPath(import.meta.url))
const vite = await createViteServer({
  configFile: false,
  root: qaRoot,
  esbuild: { jsx: 'automatic' },
  server: { middlewareMode: true, fs: { allow: [resolve(qaRoot, '../../../..')] } }
})
import { createServer } from 'node:http'
import { fixture } from './fixture'
let cleanups = []
let f
let release
let started
let began
let oldHistory
let releaseHistory
let beganHistory
let historyStarted
let holdNext = false
let abort
let holdResolve = false
let resolveStarted
let beginResolve
let releaseResolve
let failModel = false
function reset() {
  release?.()
  releaseHistory?.()
  cleanups.forEach((fn) => fn())
  cleanups = []
  f = fixture({ after: (fn) => cleanups.push(fn) } as any)
  abort = new AbortController()
  f.owner.signal = abort.signal
  started = new Promise((r) => (began = r))
  historyStarted = new Promise((r) => (beganHistory = r))
  f.setHold(async () => {
    began()
    await new Promise((r) => (release = r))
    if (failModel) throw Error('Synthetic model failure')
  })
  holdNext = false
  failModel = false
  holdResolve = false
  resolveStarted = new Promise((r) => (beginResolve = r))
}
reset()
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/')) {
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end()
    })
    return
  }
  try {
    let body = ''
    for await (const c of req) body += c
    const args = JSON.parse(body || '[]')
    const name = req.url.slice(5)
    let result
    if (name === 'fail') {
      failModel = true
      result = true
    } else if (name === 'reset') {
      reset()
      result = true
    } else if (name === 'started') {
      await started
      result = true
    } else if (name === 'historyStarted') {
      await historyStarted
      result = true
    } else if (name === 'holdResolve') {
      holdResolve = true
      result = true
    } else if (name === 'resolveStarted') {
      await resolveStarted
      result = true
    } else if (name === 'releaseResolve') {
      releaseResolve?.()
      result = true
    } else if (name === 'holdHistory') {
      holdNext = true
      result = true
    } else if (name === 'releaseHistory') {
      releaseHistory?.()
      result = true
    } else if (name === 'release') {
      release?.()
      result = true
    } else if (name === 'ask') result = await f.controller.ask(args[0], f.owner)
    else if (name === 'history') {
      const hold = holdNext
      holdNext = false
      result = await f.controller.history(f.owner)
      if (hold) {
        beganHistory()
        await new Promise((r) => (releaseHistory = r))
      }
    } else if (name === 'clear') result = await f.controller.clear(f.owner)
    else if (name === 'cancel') result = await f.controller.cancel(args[0], f.owner)
    else if (name === 'revoke') {
      abort.abort()
      release?.()
      result = true
    } else if (name === 'mutate') {
      f.put('Orchid source changed.')
      void f.controller.invalidate()
      release?.()
      result = true
    } else if (name === 'resolve') {
      result = await f.controller.resolve(args[0], args[1], f.owner)
      if (holdResolve) {
        holdResolve = false
        beginResolve()
        await new Promise((r) => (releaseResolve = r))
      }
    } else if (name === 'saved')
      result = f.store.read().map((e) => ({ id: e.id, claim: e.citedAnswer?.claims[0]?.text }))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result ?? null))
  } catch (e) {
    res.writeHead(500)
    res.end(JSON.stringify({ error: String(e) }))
  }
}).listen(0, '127.0.0.1', () =>
  console.log('Synthetic lifecycle QA: http://127.0.0.1:' + server.address().port)
)
process.on('SIGINT', async () => {
  release?.()
  releaseHistory?.()
  releaseResolve?.()
  server.closeAllConnections()
  server.close()
  await vite.close()
  cleanups.forEach((fn) => fn())
  process.exit()
})
