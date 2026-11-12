import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { overlaySize, type OverlayView } from './dictation-overlay-view'
import { dockedBounds, type Rect } from '../shared/dictation-pill'

// Run the real host controller without launching Electron's process in the unit suite.
interface Controller {
  lastView: OverlayView
  messageId: number
  loaded: boolean
  window: {
    isDestroyed(): boolean
    isVisible(): boolean
    showInactive(): void
    hide(): void
    setBounds(bounds: Rect): void
    webContents: { executeJavaScript(script: string): Promise<unknown> }
  }
  handle(name: string, messageId: number | null): void
  measuredMessageHeight: number | null
  push(window: Controller['window'], view: OverlayView): void
  render(view: OverlayView): void
  position(window: Controller['window'], view: OverlayView): void
}
function host(result: boolean | Promise<boolean> = true): {
  overlay: Controller
  actions: Array<{ name: string; gen: number | null }>
  scripts: string[]
  bounds: Rect[]
  moveCursor: (display: number) => void
  followTick: () => void
  following: () => boolean
} {
  const compiled = ts.transpileModule(
    readFileSync(new URL('./dictation-overlay.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }
  ).outputText
  const exports: {
    DictationOverlay?: new (
      action: (name: string, gen: number | null) => Promise<boolean>,
      edge: () => void
    ) => Controller
  } = {}
  const bounds: Rect[] = []
  let cursorDisplay = 0
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } },
    { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
  ]
  let intervalId = 0
  const intervals = new Map<number, () => void>()
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === 'electron')
        return {
          nativeTheme: { shouldUseDarkColors: false },
          screen: {
            getCursorScreenPoint: () => ({ x: cursorDisplay * 1440 + 100, y: 100 }),
            getDisplayNearestPoint: () => displays[cursorDisplay],
            getAllDisplays: () => displays
          }
        }
      if (name === './dictation-overlay-view') return { overlaySize }
      if (name === '../shared/dictation-pill') return { dockedBounds }
      return {}
    },
    setInterval: (tick: () => void) => {
      const id = ++intervalId
      intervals.set(id, tick)
      return id
    },
    clearInterval: (id: number) => intervals.delete(id),
    setTimeout,
    clearTimeout
  })
  assert.ok(exports.DictationOverlay)
  const actions: Array<{ name: string; gen: number | null }> = []
  const scripts: string[] = []
  const overlay = new exports.DictationOverlay(
    async (name, gen) => {
      actions.push({ name, gen })
      return result
    },
    () => undefined
  )
  overlay.lastView = {
    visible: true,
    mode: 'message',
    gen: 9,
    controls: { copy: true }
  } as OverlayView
  overlay.messageId = 3
  overlay.loaded = true
  overlay.window = {
    isDestroyed: () => false,
    isVisible: () => true,
    showInactive: () => undefined,
    hide: () => undefined,
    setBounds: (value) => {
      bounds.push(value)
    },
    webContents: {
      executeJavaScript: async (script) => {
        scripts.push(script)
      }
    }
  }
  return {
    overlay,
    actions,
    scripts,
    bounds,
    moveCursor: (display) => {
      cursorDisplay = display
    },
    followTick: () => {
      for (const tick of intervals.values()) tick()
    },
    following: () => intervals.size > 0
  }
}
const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('host routes stop and cancel independently from recovery Copy', async () => {
  const h = host()
  h.overlay.lastView = { ...h.overlay.lastView, mode: 'session' }
  h.overlay.handle('stop', null)
  h.overlay.handle('cancel', null)
  await settle()
  assert.deepEqual(h.actions, [
    { name: 'stop', gen: 9 },
    { name: 'cancel', gen: 9 }
  ])
  assert.deepEqual(h.scripts, [])
})

test('host reports actual clipboard success and failure to the matching card', async () => {
  for (const result of [true, false]) {
    const h = host(result)
    h.overlay.handle('copy', 3)
    await settle()
    assert.deepEqual(h.actions, [{ name: 'copy', gen: 9 }])
    assert.deepEqual(h.scripts, [`window.copyResult(3, ${result})`])
  }
})

test('host rejects stale and unversioned card actions; late clipboard acknowledgments cannot affect another card', async () => {
  let finish: (value: boolean) => void = () => undefined
  const h = host(
    new Promise<boolean>((resolve) => {
      finish = resolve
    })
  )
  h.overlay.handle('dismiss', 2)
  h.overlay.handle('dismiss', null)
  h.overlay.handle('copy', 2)
  assert.equal(h.actions.length, 0)
  h.overlay.handle('copy', 3)
  await settle()
  h.overlay.messageId = 4
  finish(true)
  await settle()
  assert.deepEqual(h.scripts, [])
  h.overlay.handle('dismiss', 4)
  assert.equal(h.actions.at(-1)?.name, 'dismiss')
  h.overlay.lastView.visible = false
  h.overlay.handle('dismiss', 4)
  assert.equal(h.actions.length, 2, 'hidden cards ignore outstanding actions')
})

test('rendered card measurements resize only the current visible message', async () => {
  const h = host()
  let resized = 0
  h.overlay.position = () => {
    resized += 1
  }
  h.overlay.window.webContents.executeJavaScript = async () => 104
  h.overlay.push(h.overlay.window, h.overlay.lastView)
  await settle()
  assert.equal(h.overlay.measuredMessageHeight, 104)
  assert.equal(resized, 1)
  let complete: (height: number) => void = () => undefined
  h.overlay.window.webContents.executeJavaScript = () =>
    new Promise<number>((resolve) => {
      complete = resolve
    })
  h.overlay.push(h.overlay.window, h.overlay.lastView)
  h.overlay.messageId += 1
  complete(180)
  await settle()
  assert.equal(resized, 1, 'late font measurements cannot resize a newer card')
  assert.equal(h.overlay.measuredMessageHeight, 104)
})

test('live and resting pills follow the pointer monitor in both directions; message controls stay put', () => {
  for (const edge of ['bottom', 'left', 'right'] as const) {
    const h = host()
    const session = {
      ...h.overlay.lastView,
      mode: 'session' as const,
      edge,
      title: 'Listening',
      detail: '',
      tone: 'active' as const,
      warning: null,
      target: null,
      diff: null,
      showStatus: true
    }
    h.overlay.render(session)
    assert.equal(h.following(), true)
    const first = h.bounds.at(-1)!
    assert.ok(first.x < 1440)
    h.moveCursor(1)
    h.followTick()
    assert.ok(
      h.bounds.at(-1)!.x >= 1440,
      'live pill follows pointer to the other monitor without new audio frames'
    )
    h.moveCursor(0)
    h.followTick()
    assert.deepEqual(h.bounds.at(-1), first, 'live pill returns when the pointer does')
    h.overlay.render({ ...session, mode: 'message', tone: 'warn', title: 'Copy your transcript.' })
    assert.equal(h.following(), false)
    const card = h.bounds.at(-1)!
    h.moveCursor(1)
    h.followTick()
    h.overlay.render({ ...session, mode: 'message', tone: 'warn', title: 'Copy your transcript.' })
    assert.deepEqual(h.bounds.at(-1), card, 'rerenders also preserve the message monitor')
    h.overlay.render({ ...session, mode: 'rest' })
    assert.equal(h.following(), true)
    assert.ok(h.bounds.at(-1)!.x >= 1440, 'resting pill resumes following')
    h.overlay.render({ ...session, visible: false })
    assert.equal(h.following(), false, 'hidden overlays do not keep polling')
  }
})
