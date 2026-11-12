import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { overlayHtml } from './dictation-overlay-page'

class Element {
  hidden = false
  textContent = ''
  className = ''
  style: Record<string, string> = {}
  hovered = false
  attrs = new Map<string, string>()
  listeners = new Map<string, (event: { preventDefault(): void }) => void>()
  classList = {
    add: (...names: string[]) => {
      this.className += ' ' + names.join(' ')
    },
    remove: (...names: string[]) => {
      this.className = this.className
        .split(' ')
        .filter((name) => !names.includes(name))
        .join(' ')
    },
    toggle: (name: string, on: boolean) => {
      this.classList.remove(name)
      if (on) this.classList.add(name)
    }
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | undefined {
    return this.attrs.get(name)
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
  addEventListener(name: string, fn: (event: { preventDefault(): void }) => void): void {
    this.listeners.set(name, fn)
  }
  matches(): boolean {
    return this.hovered
  }
  appendChild(): void {
    /* Diff layout is covered by native rendering. */
  }
  fire(name: string): void {
    if (name === 'pointerenter') this.hovered = true
    if (name === 'pointerleave') this.hovered = false
    this.listeners.get(name)?.({
      preventDefault() {
        /* Navigation is captured by the location stub. */
      }
    })
  }
}

/** Execute the actual self-contained overlay script with a deterministic clock. */
function page(): {
  window: {
    render(view: object, dark: boolean): void
    copyResult(id: number, success: boolean): void
  }
  el: (id: string) => Element
  actions: string[]
  advance: (ms: number) => void
} {
  let now = 0
  let serial = 0
  const frames = new Map<number, (now: number) => void>()
  const timers = new Map<number, { at: number; run: () => void }>()
  const elements = new Map<string, Element>()
  const el = (id: string): Element => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)!
  }
  const actions: string[] = []
  const window = {} as {
    render(view: object, dark: boolean): void
    copyResult(id: number, success: boolean): void
  }
  const script = overlayHtml().match(/<script>([\s\S]*)<\/script>/)?.[1]
  assert.ok(script)
  runInNewContext(script, {
    window,
    document: {
      getElementById: el,
      fonts: { ready: Promise.resolve() },
      documentElement: new Element(),
      createElement: () => new Element(),
      addEventListener() {
        /* No document events needed by these card tests. */
      }
    },
    location: {
      set href(value: string) {
        actions.push(value)
      }
    },
    matchMedia: () => ({ matches: false }),
    performance: { now: () => now },
    requestAnimationFrame: (fn: (time: number) => void) => {
      const id = ++serial
      frames.set(id, fn)
      return id
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (run: () => void, ms: number) => {
      const id = ++serial
      timers.set(id, { run, at: now + ms })
      return id
    },
    clearTimeout: (id: number) => timers.delete(id)
  })
  const advance = (ms: number): void => {
    now += ms
    const pending = [...frames.values()]
    frames.clear()
    for (const fn of pending) fn(now)
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id)
        timer.run()
      }
    }
  }
  return { window, el, actions, advance }
}

const message = (over: Record<string, unknown> = {}): object => ({
  visible: true,
  mode: 'message',
  edge: 'bottom',
  tone: 'warn',
  title: 'Text is ready to copy.',
  detail: 'A preserved transcript.',
  controls: { copy: true, dismiss: true },
  warning: null,
  target: null,
  diff: null,
  gen: 1,
  messageId: 1,
  ...over
})

test('message countdown dismisses after ten seconds, with a brief exit transition', () => {
  const p = page()
  p.window.render(message(), false)
  assert.equal(p.el('countdown').hidden, false)
  p.advance(9_999)
  assert.deepEqual(p.actions, [])
  p.advance(1)
  assert.match(p.el('card').className, /dismissing/)
  assert.deepEqual(p.actions, [])
  p.advance(120)
  assert.deepEqual(p.actions, ['doodle-dictation://dismiss?message=1'])
})

test('hover freezes the remaining time; ordinary rerenders do not restart it', () => {
  const p = page()
  p.window.render(message(), false)
  p.advance(4_000)
  p.el('card').fire('pointerenter')
  const progress = p.el('countdownFill').style.transform
  p.advance(20_000)
  p.window.render(message({ edge: 'left' }), true)
  assert.equal(p.el('countdownFill').style.transform, progress)
  assert.deepEqual(p.actions, [])
  p.el('card').fire('pointerleave')
  p.advance(5_999)
  assert.deepEqual(p.actions, [])
  p.advance(1)
  p.advance(120)
  assert.equal(p.actions.length, 1)
})

test('copy pauses expiry and only confirms after the clipboard succeeds; failure is retryable', () => {
  const p = page()
  p.window.render(message(), false)
  p.advance(9_000)
  p.el('copy').fire('click')
  assert.equal(p.el('copyLabel').textContent, 'Copying…')
  p.advance(20_000)
  assert.deepEqual(p.actions, ['doodle-dictation://copy?message=1'])
  p.window.copyResult(1, false)
  assert.equal(p.el('copyLabel').textContent, 'Try copying again')
  assert.equal(p.el('copyCheck').hidden, true)
  p.el('copy').fire('click')
  p.window.copyResult(1, true)
  assert.equal(p.el('copyLabel').textContent, 'Copied')
  assert.equal(p.el('copyCheck').hidden, false)
  p.advance(1_000)
  p.advance(120)
  assert.equal(p.actions.at(-1), 'doodle-dictation://dismiss?message=1')
})

test('a new card cancels stale dismissal and ignores an old copy acknowledgment', () => {
  const p = page()
  p.window.render(message(), false)
  p.el('copy').fire('click')
  p.el('dismiss').fire('click')
  p.window.render(message({ messageId: 2, gen: 2, detail: 'New transcript' }), false)
  p.window.copyResult(1, true)
  p.advance(120)
  assert.equal(p.el('copyLabel').textContent, 'Copy text')
  assert.equal(p.el('copyCheck').hidden, true)
  assert.deepEqual(p.actions, ['doodle-dictation://copy?message=1'])
  p.advance(9_880)
  p.advance(120)
  assert.equal(p.actions.at(-1), 'doodle-dictation://dismiss?message=2')
})

test('working cards never expire, and a card appearing under the pointer starts paused', () => {
  const p = page()
  p.window.render(message({ tone: 'busy' }), false)
  p.advance(30_000)
  assert.equal(p.el('countdown').hidden, true)
  assert.deepEqual(p.actions, [])
  p.el('card').hovered = true
  p.window.render(message({ messageId: 2 }), false)
  p.advance(30_000)
  assert.equal(p.el('countdownFill').style.transform, 'scaleX(1)')
  assert.deepEqual(p.actions, [])
})

test('successful Copy shows confirmation for 450ms then fades while still hovered', () => {
  const p = page()
  p.window.render(message(), false)
  p.el('card').fire('pointerenter')
  p.el('copy').fire('click')
  p.window.copyResult(1, true)
  p.advance(449)
  assert.equal(p.el('copyLabel').textContent, 'Copied')
  assert.doesNotMatch(p.el('card').className, /dismissing/)
  p.window.render(message(), false)
  p.el('copy').fire('click')
  assert.equal(p.actions.length, 1, 'repeat copy cannot extend the confirmation')
  p.advance(1)
  assert.match(p.el('card').className, /dismissing/)
  p.advance(119)
  assert.equal(p.actions.length, 1)
  p.advance(1)
  assert.equal(p.actions.at(-1), 'doodle-dictation://dismiss?message=1')
})

test('failed Copy stays available for retry instead of scheduling the quick close', () => {
  const p = page()
  p.window.render(message(), false)
  p.el('card').fire('pointerenter')
  p.el('copy').fire('click')
  p.window.copyResult(1, false)
  p.advance(2_000)
  assert.doesNotMatch(p.el('card').className, /dismissing/)
  assert.equal(p.el('copyLabel').textContent, 'Try copying again')
  assert.equal(p.actions.length, 1)
  p.el('copy').fire('click')
  assert.equal(p.actions.length, 2)
})

test('new messages cancel the old successful-copy close timer', () => {
  const p = page()
  p.window.render(message(), false)
  p.el('copy').fire('click')
  p.window.copyResult(1, true)
  p.advance(200)
  p.window.render(message({ messageId: 2, gen: 2 }), false)
  p.advance(500)
  assert.doesNotMatch(p.el('card').className, /dismissing/)
  assert.equal(p.el('copyLabel').textContent, 'Copy text')
  assert.equal(p.actions.length, 1)
})
