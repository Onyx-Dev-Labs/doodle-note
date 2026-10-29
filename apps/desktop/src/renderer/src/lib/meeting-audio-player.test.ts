import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
import type { AudioFileData, AudioPart } from '../../../shared/audio-api'
import type { useMeetingAudioPlayer } from './use-meeting-audio-player'

type Player = ReturnType<typeof useMeetingAudioPlayer>
type Slot = {
  value?: unknown
  deps?: unknown[]
  cleanup?: () => void
  effect?: () => void | (() => void)
}
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const first: AudioPart = {
  url: 'doodle-audio://meeting/1000/audio.wav',
  startEpochMs: 1000,
  durationMs: 1000
}
const retained: AudioPart = {
  url: 'doodle-audio://meeting/2000/audio.wav',
  startEpochMs: 2000,
  durationMs: 1000
}
const last: AudioPart = {
  url: 'doodle-audio://meeting/3000/audio.wav',
  startEpochMs: 3000,
  durationMs: 1000
}
const bytes: AudioFileData = { bytes: new Uint8Array(44), mime: 'audio/wav' }

/** Execute the actual production hook with state/effect/ref scheduling doubles.
 * Media and blob APIs are doubles: this proves source ownership, not native decoding.
 * No copied player logic, React internals, DOM, Electron, or native process is used.
 */
function mountPlayer(): {
  readonly player: Player
  media: {
    src: string
    currentSrc: string
    currentTime: number
    paused: boolean
    readyState: number
    pause(): void
    play(): Promise<void>
  }
  reads: Array<{
    url: string
    resolve: (data: AudioFileData | null) => void
    reject: (error: Error) => void
  }>
  revoked: string[]
  refresh(parts: AudioPart[]): Player
  resolve(index: number, data?: AudioFileData | null): Promise<Player>
  settle(): Promise<Player>
  metadata(): Player
  unmount(): void
} {
  const slots: Slot[] = []
  let cursor = 0
  let dirty = true
  let mounted = true
  let player!: Player
  const reads: Array<{
    url: string
    resolve: (data: AudioFileData | null) => void
    reject: (error: Error) => void
  }> = []
  const revoked: string[] = []
  let blobCount = 0
  const media = {
    src: '',
    currentSrc: '',
    currentTime: 0,
    paused: true,
    readyState: 0,
    pause() {
      this.paused = true
    },
    async play() {
      this.paused = false
    }
  }
  const hooks = {
    useState(initial: unknown) {
      const slot = (slots[cursor] ??= {
        value: typeof initial === 'function' ? initial() : initial
      })
      cursor++
      return [
        slot.value,
        (update: unknown) => {
          assert.ok(mounted, 'no state publication after unmount')
          const value = typeof update === 'function' ? update(slot.value) : update
          if (!Object.is(value, slot.value)) {
            slot.value = value
            dirty = true
          }
        }
      ]
    },
    useRef(initial: unknown) {
      const slot = (slots[cursor] ??= { value: { current: initial } })
      cursor++
      return slot.value
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const slot = (slots[cursor] ??= {})
      cursor++
      if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) {
        slot.effect = effect
        slot.deps = deps
      }
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const slot = (slots[cursor] ??= {})
      cursor++
      if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps![i]))) {
        slot.value = callback
        slot.deps = deps
      }
      return slot.value
    }
  }
  // Transpile the production module rather than duplicating its implementation.
  const compiled = ts.transpileModule(
    readFileSync(new URL('./use-meeting-audio-player.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }
  ).outputText
  const exports = {} as { useMeetingAudioPlayer: typeof useMeetingAudioPlayer }
  new Function('require', 'exports', 'URL', compiled)(
    (name: string) => {
      assert.equal(name, 'react')
      return hooks
    },
    exports,
    {
      createObjectURL: () => `blob:fixture-${++blobCount}`,
      revokeObjectURL: (url: string) => revoked.push(url)
    }
  )
  const audio = {
    read: (url: string) =>
      new Promise<AudioFileData | null>((resolve, reject) => reads.push({ url, resolve, reject }))
  }
  function flush(): Player {
    let renders = 0
    while (dirty) {
      assert.ok(++renders < 30, 'hook settles without a render loop')
      dirty = false
      cursor = 0
      player = exports.useMeetingAudioPlayer(audio)
      const src = player.playerSrc ?? ''
      if (src !== media.src) {
        media.src = src
        media.currentSrc = src
        media.currentTime = 0
        media.paused = true
        media.readyState = 0
      }
      player.audioRef.current = player.audioParts.length
        ? (media as unknown as HTMLAudioElement)
        : null
      for (const slot of slots) {
        if (!slot.effect) continue
        const effect = slot.effect
        slot.effect = undefined
        slot.cleanup?.()
        slot.cleanup = effect() || undefined
      }
    }
    return player
  }
  flush()
  return {
    get player() {
      return flush()
    },
    media,
    reads,
    revoked,
    refresh(parts: AudioPart[]) {
      player.setAudioParts(parts)
      return flush()
    },
    async resolve(index: number, data: AudioFileData | null = bytes) {
      reads[index]!.resolve(data)
      await settle()
      return flush()
    },
    async settle() {
      await settle()
      return flush()
    },
    metadata() {
      media.readyState = 1
      player.onLoadedMetadata()
      return flush()
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.()
      mounted = false
    }
  }
}

for (const [name, parts] of [
  ['append and metadata update', [{ ...retained, durationMs: 2000 }, last]],
  ['insert before selection', [first, retained]]
] as const) {
  test(`recovery preserves selected source, position and playback: ${name}`, async () => {
    const view = mountPlayer()
    try {
      view.refresh([retained])
      await view.resolve(0)
      view.metadata()
      view.media.currentTime = 0.6
      await view.media.play()
      const src = view.player.playerSrc
      view.refresh([...parts])
      assert.equal(view.player.audioParts[view.player.activePart]?.url, retained.url)
      assert.equal(view.reads.length, 1, 'unchanged recording is not read again')
      assert.equal(view.player.playerSrc, src)
      assert.equal(view.media.currentTime, 0.6)
      assert.equal(view.media.paused, false)
      assert.deepEqual(view.revoked, [])
      assert.equal(view.player.audioParts.length, 2, 'new parts are retained')
    } finally {
      view.unmount()
    }
  })
}

const segment = (
  startMs: number,
  absoluteStartMs?: number
): Parameters<Player['seekToSegment']>[0] => ({
  id: 'segment',
  channel: 'mic',
  speaker: 'Speaker',
  text: 'Synthetic text',
  startMs,
  endMs: startMs + 100,
  confidence: 1,
  absoluteStartMs
})

test('explicit selection, transcript seek and ended advance follow identities after recovery reorders parts', async () => {
  const view = mountPlayer()
  try {
    view.refresh([retained, last])
    await view.resolve(0)
    view.metadata()
    view.player.selectPart(last.url)
    assert.equal(view.player.audioParts[view.player.activePart]?.url, last.url)
    assert.equal(
      view.player.playerSrc,
      null,
      'old bytes cannot masquerade as the selected recording'
    )
    view.refresh([first, retained, last])
    await view.resolve(1)
    view.metadata()
    assert.equal(view.media.currentTime, 0)
    assert.equal(view.media.paused, false)

    // Absolute time selects retained; recovery refresh while its bytes load must
    // neither reroute that seek to the older part nor trigger an extra read.
    view.player.seekToSegment(segment(0, 2450))
    assert.equal(view.player.activePart, 1)
    view.refresh([first, { ...retained, durationMs: 1500 }, last])
    view.metadata() // obsolete/no source metadata cannot consume the pending seek
    assert.equal(view.reads.length, 3)
    await view.resolve(2)
    view.metadata()
    assert.equal(view.media.currentTime, 0.45)
    assert.equal(view.media.paused, false)
    const src = view.player.playerSrc
    view.player.seekToSegment(segment(700)) // cloud-stripped absolute timestamp
    assert.equal(view.media.currentTime, 0.7)
    assert.equal(view.player.playerSrc, src)
    assert.equal(view.reads.length, 3)
    view.metadata()
    assert.equal(view.media.currentTime, 0.7, 'metadata does not replay a consumed seek')

    assert.equal(view.player.advance(), true)
    assert.equal(view.player.audioParts[view.player.activePart]?.url, last.url)
    await view.resolve(3)
    view.metadata()
    assert.equal(view.media.currentTime, 0)
    assert.equal(view.media.paused, false)
    assert.equal(view.player.advance(), false)
  } finally {
    view.unmount()
  }
})

test('paused playback and fresh metadata survive new Resume parts; removed/empty selection has a safe fallback', async () => {
  const view = mountPlayer()
  try {
    assert.equal(view.player.activePart, -1)
    assert.equal(view.player.playerSrc, null)
    view.refresh([retained])
    await view.resolve(0)
    view.metadata()
    view.media.currentTime = 0.8
    const src = view.player.playerSrc
    view.refresh([{ ...retained, durationMs: 2500 }, last])
    assert.equal(view.player.playerSrc, src)
    assert.equal(view.media.paused, true)
    assert.equal(view.media.currentTime, 0.8)
    assert.deepEqual(
      view.player.audioParts.map((part) => part.durationMs),
      [2500, 1000]
    )
    assert.equal(view.reads.length, 1)

    view.refresh([last])
    assert.equal(view.player.activePart, 0)
    assert.equal(view.player.playerSrc, null)
    assert.deepEqual(view.revoked, [src])
    view.refresh([])
    await view.resolve(1) // completion from removed part cannot create a blob
    assert.equal(view.player.playerSrc, null)
    assert.equal(view.player.activePart, -1)
    assert.deepEqual(view.revoked, [src])
    assert.equal(view.player.advance(), false)
    view.player.selectPart(last.url) // stale UI event for a removed recording
    view.player.seekToSegment(segment(100))
    assert.equal(view.reads.length, 2)
    view.refresh([first])
    await view.resolve(2)
    view.metadata()
    assert.equal(view.media.paused, true, 'fallback does not replay an obsolete pending seek')
    assert.equal(view.media.currentTime, 0)
  } finally {
    view.unmount()
  }
  assert.equal(view.revoked.length, 2, 'each allocated blob is revoked exactly once')
})

test('rapid A to B to A selection rejects stale bytes and never reuses a revoked blob', async () => {
  const view = mountPlayer()
  try {
    view.refresh([retained, last])
    await view.resolve(0)
    const oldSrc = view.player.playerSrc
    view.player.selectPart(last.url)
    view.player.selectPart(retained.url)
    assert.equal(view.player.playerSrc, null)
    assert.deepEqual(view.revoked, [oldSrc])
    await view.resolve(1)
    assert.equal(view.player.playerSrc, null)
    await view.resolve(2)
    assert.notEqual(view.player.playerSrc, oldSrc)
    view.metadata()
    assert.equal(view.media.paused, false)
  } finally {
    view.unmount()
  }
  assert.equal(view.revoked.length, 2)
})

for (const result of ['missing', 'rejected', 'unmounted'] as const) {
  test(`byte-read ${result} leaves no stale source or leaked blob`, async () => {
    const view = mountPlayer()
    view.refresh([first, retained])
    await view.resolve(0)
    const src = view.player.playerSrc
    view.player.selectPart(retained.url)
    assert.equal(view.player.playerSrc, null)
    if (result === 'unmounted') view.unmount()
    try {
      if (result === 'rejected') {
        view.reads[1]!.reject(new Error('read failed'))
        await view.settle()
      } else await view.resolve(1, result === 'missing' ? null : bytes)
      assert.equal(view.player.playerSrc, null)
      assert.deepEqual(view.revoked, [src])
    } finally {
      if (result !== 'unmounted') view.unmount()
    }
  })
}
