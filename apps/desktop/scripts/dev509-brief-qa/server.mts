import { createServer as createViteServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createServer, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { SourceIndexClient } from '@repo/meetings-store/source-index-client'
import { localSourceScope } from '@repo/meetings-store/sources'
import { buildCitedAskPrompt } from '@repo/ai'
import { createCitedAskHost } from '../../src/main/cited-ask-host'
import { installBriefs } from '../../src/main/brief-installer'
import { LibraryActivity } from '../../src/main/library-activity'
import { RecordingStartCoordinator } from '../../src/main/recording-start-coordinator'
import { scopeCalendar, scopeEvent } from '../../src/main/calendar-identity'
import { normalizeCalendarInvitees } from '../../src/main/calendar-context-normalization'
import { BRIEFS_INVOKE } from '../../src/shared/briefs-api'
import type { BriefIpcEvent } from '../../src/main/brief-ipc'
const qaRoot = dirname(fileURLToPath(import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-renderer-')))
const meetingsDir = join(root, 'meetings')
mkdirSync(meetingsDir)
const sourceFile = join(meetingsDir, 'orchid.json')
const put = (text: string): void =>
  writeFileSync(
    sourceFile,
    JSON.stringify({
      id: 'orchid',
      title: 'Orchid planning',
      rawNotesMarkdown: text,
      createdAt: '2026-10-01T12:00:00Z',
      unknown: { retained: true }
    })
  )
put('Orchid: revise the proposal before the next review. This decision was recorded on October 1.')
const original = readFileSync(sourceFile)
const scope = localSourceScope(meetingsDir, true)
const require = createRequire(import.meta.url)
const worker = new Worker(
  `require(${JSON.stringify(require.resolve('tsx/cjs'))});require(${JSON.stringify(require.resolve('@repo/meetings-store/source-index-worker'))});`,
  { eval: true, workerData: { meetingsDir, cacheDir: join(root, 'cache') } }
)
const sources = new SourceIndexClient(worker, () => ({ meetingsDir, scope, authorized: true }))
const identity = { provider: 'google' as const, subject: 'synthetic-account' }
const calendar = scopeCalendar(identity, {
  id: 'calendar',
  name: 'Synthetic calendar',
  colorHex: '#788f67',
  isDefault: true,
  canEdit: false
})
const event = scopeEvent(identity, calendar, {
  id: 'review',
  subject: 'Orchid proposal review — synthetic fixture',
  startIso: new Date(Date.now() + 3600000).toISOString(),
  endIso: new Date(Date.now() + 7200000).toISOString(),
  isAllDay: false,
  isOnlineMeeting: false,
  hasParticipants: true,
  calendarId: calendar.id,
  sourceLabel: 'Synthetic account · Project calendar',
  stale: true,
  invitees: normalizeCalendarInvitees('google', {
    attendeesOmitted: true,
    attendees: [
      { displayName: 'Alex Rivera', email: 'alex@example.test' },
      { displayName: 'Room A', email: 'room@example.test', resource: true }
    ]
  })
})
let connected = true,
  epoch = 0,
  generated = 0,
  held = false,
  generating = false,
  modelFails = false
let release: (() => void) | undefined
const listeners = new Set<() => void>()
const streams = new Set<ServerResponse>()
const renderer = {
  id: 1,
  mainFrame: {},
  isDestroyed: () => false,
  send: (channel: string, value: unknown) => {
    for (const stream of streams) stream.write(`data: ${JSON.stringify({ channel, value })}\n\n`)
  }
}
const activity = new LibraryActivity()
const host = createCitedAskHost(
  {
    sources,
    activity,
    validateModel: async () => true,
    generate: async (input) => {
      generated++
      generating = true
      try {
        if (held)
          await new Promise<void>((r) => {
            release = r
          })
        if (modelFails) throw new Error('Synthetic model failure')
        const prompt = buildCitedAskPrompt(input, {
          contextWindowTokens: 16384,
          outputReserveTokens: 4096,
          safetyMarginTokens: 256,
          accounting: 'model-tokenizer',
          countInputTokens: (a, b) => Buffer.byteLength(a + b)
        })
        return {
          rawJson: JSON.stringify({
            status: 'answered',
            claims: [
              {
                id: 'claim',
                kind: 'quotation',
                text: 'ignored in favor of exact original',
                evidenceIds: [prompt.inclusion.ranges[0]!.id]
              }
            ]
          }),
          inclusion: prompt.inclusion,
          engineId: 'local:synthetic',
          modelArtifactRevision: 'synthetic-generator'
        }
      } finally {
        generating = false
      }
    }
  },
  () => renderer
)
const handlers = new Map<string, (event: BriefIpcEvent, request: unknown) => Promise<unknown>>()
const installer = installBriefs({
  root: () => root,
  assertAvailable: () => {},
  enabled: () => true,
  activity,
  host,
  sources,
  calendar: {
    resolveBrief: (id) => {
      if (!connected || id !== event.id) return null
      const captured = epoch
      return {
        event,
        lastSyncIso: '2026-10-18T12:00:00Z',
        assertCurrent: () => {
          if (!connected || captured !== epoch) throw new Error('Calendar changed')
        }
      }
    },
    subscribeBrief: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  },
  ipc: {
    handle: (channel, fn) => {
      handlers.set(channel, fn)
    },
    removeHandler: (channel) => {
      handlers.delete(channel)
    }
  },
  recording: new RecordingStartCoordinator(
    () => {
      throw new Error('Recording forbidden in fixture')
    },
    () => {}
  ),
  power: new EventEmitter(),
  warn: () => {}
})
let vite: Awaited<ReturnType<typeof createViteServer>>
const server = createServer(async (req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(': ready\n\n')
    streams.add(res)
    req.on('close', () => streams.delete(res))
    return
  }
  if (!req.url?.startsWith('/api/')) {
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end()
    })
    return
  }
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 65536) throw new Error('Fixture request too large')
    }
    const args = JSON.parse(body || '[]')
    let value: unknown
    switch (req.url.slice(5)) {
      case 'info':
        value = event
        break
      case 'invoke':
        value = await handlers.get(BRIEFS_INVOKE)!(
          { sender: renderer, senderFrame: renderer.mainFrame },
          { method: args[0], args: args.slice(1) }
        )
        break
      case 'stats':
        value = {
          generated,
          generating,
          originalsUnchanged: original.equals(readFileSync(sourceFile)),
          originalSha: createHash('sha256').update(readFileSync(sourceFile)).digest('hex')
        }
        break
      case 'hold':
        held = true
        value = true
        break
      case 'release':
        held = false
        release?.()
        value = true
        break
      case 'fail':
        modelFails = true
        value = true
        break
      case 'disconnect':
        connected = false
        epoch++
        listeners.forEach((fn) => fn())
        value = true
        break
      case 'reconnect':
        connected = true
        epoch++
        listeners.forEach((fn) => fn())
        value = true
        break
      case 'invalidate':
        void host.invalidate()
        value = true
        break
      case 'mutate':
        put('Orchid changed in the original.')
        void host.invalidate()
        value = true
        break
      default:
        throw new Error('Unknown fixture action')
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(value ?? null))
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Fixture unavailable' }))
  }
})
vite = await createViteServer({
  configFile: false,
  root: qaRoot,
  esbuild: { jsx: 'automatic' },
  server: { hmr: { server }, middlewareMode: true, fs: { allow: [resolve(qaRoot, '../../../..')] } }
})
server.listen(0, '127.0.0.1', () =>
  console.log(`Synthetic Brief QA: http://127.0.0.1:${(server.address() as { port: number }).port}`)
)
process.on('SIGINT', async () => {
  release?.()
  server.closeAllConnections()
  server.close()
  await installer.dispose()
  await sources.close()
  await vite.close()
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
})
