import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// The production host (createDictationHost) end to end, with Electron stubbed: what the service sees
// of the engine is what the host forwards, so the Windows "refuse until Parakeet is ready" gate and
// the download retry must reach the service through the real wrapper.
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
// A catch-all stand-in for every Electron object the host and its overlay touch.
const anything: unknown = new Proxy(
  function stand() {
    return undefined
  },
  {
    get: (_target, property) => (property === 'then' ? undefined : anything),
    apply: () => anything,
    construct: () => anything as object
  }
)
const electron = new Proxy(
  {
    systemPreferences: {
      getMediaAccessStatus: () => 'granted',
      askForMediaAccess: async () => true
    },
    globalShortcut: { register: () => true, unregister: () => {}, isRegistered: () => false }
  } as Record<string | symbol, unknown>,
  { get: (target, property) => (property in target ? target[property] : anything) }
)
loader._load = (id, ...args) => (id === 'electron' ? electron : originalLoad(id, ...args))
const { createDictationHost } = require('./dictation-host') as typeof import('./dictation-host')
const { DictationOverlay } = require('./dictation-overlay') as typeof import('./dictation-overlay')
loader._load = originalLoad

/** A minimal valid PE32+ image with one section (passes the helper digest's layout checks). */
function fakeHelper(): Buffer {
  const image = Buffer.alloc(0x400)
  image.writeUInt16LE(0x5a4d, 0)
  image.writeUInt32LE(0x80, 0x3c)
  image.writeUInt32LE(0x00004550, 0x80)
  image.writeUInt16LE(1, 0x80 + 6) // one section
  image.writeUInt16LE(240, 0x80 + 20)
  const optional = 0x80 + 24
  image.writeUInt16LE(0x20b, optional)
  image.writeUInt32LE(0x200, optional + 60) // SizeOfHeaders
  image.writeUInt32LE(16, optional + 108)
  const section = optional + 240
  image.writeUInt32LE(0x200, section + 16) // SizeOfRawData
  image.writeUInt32LE(0x200, section + 20) // PointerToRawData
  image.fill(0x90, 0x200)
  return image
}

test('Windows: the packaged host forwards the model gate and the retry to the service', async () => {
  const views: Array<{ title?: string }> = []
  const originalRender = DictationOverlay.prototype.render
  DictationOverlay.prototype.render = function (view) {
    views.push(view)
  }
  const dir = mkdtempSync(join(tmpdir(), 'bark-host-'))
  const helperPath = join(dir, 'dictation-helper.exe')
  const helper = fakeHelper()
  writeFileSync(helperPath, helper)
  const { stableHelperDigest } = await import('./helper-integrity')
  writeFileSync(
    join(dir, 'dictation-helper.manifest.json'),
    JSON.stringify({
      authenticodeSha256: stableHelperDigest(helper),
      sha256: createHash('sha256').update(helper).digest('hex')
    })
  )
  // Bark on, with no hold key or mouse button, so nothing spawns the stand-in helper.
  writeFileSync(join(dir, 'dictation.json'), JSON.stringify({ enabled: true, holdKey: 'off' }))
  let retries = 0
  const starts: unknown[] = []
  let failed = false
  const statuses: Array<{ helper?: string }> = []
  try {
    const { service } = createDictationHost({
      channel: 'release',
      userData: dir,
      logsDir: dir,
      helperPath,
      packaged: false,
      platform: 'win32',
      engine: {
        tryStartLive: (opts) => {
          starts.push(opts)
          return { started: true }
        },
        stop: () => {},
        running: false,
        warm: true,
        dictationModelState: () => ({
          ready: false,
          downloadProgress: failed ? null : 0.3,
          usingFallback: true,
          downloadFailed: failed
        }),
        retryDictationModel: () => {
          retries += 1
          return 'started'
        }
      },
      notes: () => null,
      meetingBusy: () => false,
      setMicHeld: () => {},
      showMainWindow: () => {},
      isTrustedSender: () => true,
      broadcast: (_channel, payload) => statuses.push(payload as { helper?: string })
    })
    // The helper integrity check runs first (asynchronously); wait for its verdict.
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    service.toggle()
    for (let i = 0; i < 400 && statuses.at(-1)?.helper !== 'ready'; i++) await pause(25)
    assert.equal(statuses.at(-1)?.helper, 'ready', 'the stand-in helper passed the integrity check')
    await pause(300) // past the toggle debounce
    service.toggle()
    await pause(10)
    assert.match(String(views.at(-1)?.title), /Downloading the speech model… 30%/)
    assert.deepEqual(starts, [], 'Bark does not dictate on the fallback model')
    failed = true
    await pause(300)
    service.toggle()
    await pause(10)
    assert.equal(retries, 1, 'the host forwards the retry')
    assert.match(String(views.at(-1)?.title), /Retrying the download now/)
  } finally {
    DictationOverlay.prototype.render = originalRender
  }
})
