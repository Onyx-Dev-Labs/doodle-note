import { useEffect, useReducer, useRef, useState } from 'react'
import type {
  EngineChannel,
  EngineCommand,
  EngineEvent,
  EngineFinalEvent,
  TranscriptSegment
} from '../../shared/engine-events'

const MAX_LOG_ENTRIES = 200
const LIVE_CHANNELS: readonly EngineChannel[] = ['mic', 'system']
const CHANNEL_LABELS: Record<EngineChannel, string> = {
  mic: 'You (mic)',
  system: 'Them (system audio)'
}

type StatusKind = 'idle' | 'busy' | 'ready' | 'done' | 'error'

interface LogEntry {
  id: number
  ts: string
  text: string
}

interface ConsoleState {
  running: boolean
  mode: 'file' | 'live'
  statusKind: StatusKind
  statusText: string
  partial: string
  finals: EngineFinalEvent[]
  livePartials: Partial<Record<EngineChannel, string>>
  liveFinals: Partial<Record<EngineChannel, string>>
  segments: TranscriptSegment[]
  echoCount: number
  log: LogEntry[]
  nextLogId: number
}

const initialState: ConsoleState = {
  running: false,
  mode: 'file',
  statusKind: 'idle',
  statusText: 'idle',
  partial: '',
  finals: [],
  livePartials: {},
  liveFinals: {},
  segments: [],
  echoCount: 0,
  log: [],
  nextLogId: 1
}

function segmentTime(segment: TranscriptSegment): number {
  return segment.absoluteStartMs ?? segment.startMs
}

function formatOffset(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

function timestamp(): string {
  const d = new Date()
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function appendLog(state: ConsoleState, ev: EngineEvent): ConsoleState {
  const entry: LogEntry = { id: state.nextLogId, ts: timestamp(), text: JSON.stringify(ev) }
  return {
    ...state,
    log: [...state.log, entry].slice(-MAX_LOG_ENTRIES),
    nextLogId: state.nextLogId + 1
  }
}

function reducer(state: ConsoleState, ev: EngineEvent): ConsoleState {
  const base = appendLog(state, ev)
  switch (ev.event) {
    case 'started':
      return {
        ...base,
        running: true,
        mode: ev.command === 'live' ? 'live' : 'file',
        statusKind: 'busy',
        statusText: ev.command === 'live' ? 'starting live capture…' : `starting ${ev.command}…`,
        partial: '',
        finals: [],
        livePartials: {},
        liveFinals: {},
        segments: [],
        echoCount: 0
      }
    case 'status': {
      if (ev.stage === 'requesting_permission') {
        const which = (ev.permission ?? 'capture').replace(/_/g, ' ')
        return {
          ...base,
          statusKind: 'busy',
          statusText: `waiting for macOS permission — ${which}`
        }
      }
      const stage = (ev.stage ?? 'working').replace(/_/g, ' ')
      const suffix = ev.channel ? ` [${ev.channel}]` : ''
      return {
        ...base,
        statusKind: 'busy',
        statusText: ev.model ? `${stage}${suffix} (${ev.model})` : `${stage}${suffix}`
      }
    }
    case 'download':
      return {
        ...base,
        statusKind: 'busy',
        statusText: `downloading model ${Math.round((ev.progress ?? 0) * 100)}%`
      }
    case 'ready':
      if (ev.channels && ev.channels.length > 0) {
        return {
          ...base,
          statusKind: 'ready',
          statusText: `listening (${ev.channels.join(' + ')}) — speak, or play audio`
        }
      }
      return {
        ...base,
        statusKind: 'ready',
        statusText: ev.model ? `ready (${ev.model}) — transcribing…` : 'ready — transcribing…'
      }
    case 'partial':
      if (ev.channel) {
        return { ...base, livePartials: { ...base.livePartials, [ev.channel]: ev.text } }
      }
      return { ...base, partial: ev.text }
    case 'timings':
      // Segment-building raw material; surfaced in the raw log only for now.
      return base
    case 'final':
      if (ev.channel) {
        return {
          ...base,
          liveFinals: { ...base.liveFinals, [ev.channel]: ev.text },
          statusKind: 'busy',
          statusText: `finalizing… (${ev.channel} done)`
        }
      }
      return {
        ...base,
        partial: '',
        finals: [...base.finals, ev],
        statusKind: 'done',
        statusText: 'done'
      }
    case 'refined':
      return {
        ...base,
        liveFinals: Object.fromEntries(ev.transcripts.map((item) => [item.channel, item.text])),
        statusKind: 'busy',
        statusText: 'high-accuracy transcript ready'
      }
    case 'segments': {
      const kept = ev.segments.filter((s) => !s.echo)
      const echoDropped = ev.segments.length - kept.length
      const merged = [...base.segments, ...kept].sort((a, b) => segmentTime(a) - segmentTime(b))
      return { ...base, segments: merged, echoCount: base.echoCount + echoDropped }
    }
    case 'segments-replaced': {
      const kept = ev.segments.filter((s) => !s.echo)
      return {
        ...base,
        segments: kept.sort((a, b) => segmentTime(a) - segmentTime(b)),
        echoCount: ev.segments.length - kept.length
      }
    }
    case 'session-saved':
      return {
        ...base,
        statusKind: 'done',
        statusText: `saved ${ev.segmentCount} segments → ${ev.path}`
      }
    case 'channel_start':
      return base
    case 'audio':
      return {
        ...base,
        statusKind: 'done',
        statusText: `audio saved (${Math.round(ev.durationMs / 1000)}s) → ${ev.path}`
      }
    case 'done':
      return { ...base, statusKind: 'done', statusText: 'session complete' }
    case 'error':
      return { ...base, statusKind: 'error', statusText: ev.message }
    case 'spawn-error':
      return { ...base, running: false, statusKind: 'error', statusText: ev.message }
    case 'exit': {
      if (base.statusKind === 'error' || base.statusKind === 'done') {
        return { ...base, running: false }
      }
      if (ev.code === 0) {
        return { ...base, running: false, statusKind: 'done', statusText: 'done (engine exited)' }
      }
      if (ev.code === null) {
        return {
          ...base,
          running: false,
          statusKind: 'idle',
          statusText: `stopped${ev.signal ? ` (${ev.signal})` : ''}`
        }
      }
      return {
        ...base,
        running: false,
        statusKind: 'error',
        statusText: `engine exited with code ${ev.code}`
      }
    }
  }
}

function FinalMeta({ final }: { final: EngineFinalEvent }): React.JSX.Element {
  const parts: string[] = []
  if (typeof final.confidence === 'number') {
    parts.push(`confidence ${final.confidence.toFixed(2)}`)
  }
  if (typeof final.audioSeconds === 'number' && typeof final.processingSeconds === 'number') {
    parts.push(`${final.audioSeconds.toFixed(1)}s audio in ${final.processingSeconds.toFixed(2)}s`)
  }
  const speedup =
    typeof final.speedup === 'number' && final.speedup > 0
      ? final.speedup
      : typeof final.audioSeconds === 'number' &&
          typeof final.processingSeconds === 'number' &&
          final.processingSeconds > 0
        ? final.audioSeconds / final.processingSeconds
        : undefined
  if (speedup !== undefined) {
    parts.push(`${speedup.toFixed(1)}× realtime`)
  }
  return <div className="final-meta">{parts.join(' · ')}</div>
}

function LivePane({
  channel,
  finalText,
  partialText
}: {
  channel: EngineChannel
  finalText?: string
  partialText?: string
}): React.JSX.Element {
  const text = finalText ?? partialText ?? ''
  const paneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = paneRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="live-pane">
      <div className="live-label">{CHANNEL_LABELS[channel]}</div>
      <div className="live-text" ref={paneRef}>
        {text ? (
          <p className={finalText !== undefined ? 'final-text' : 'partial'}>{text}</p>
        ) : (
          <span className="placeholder">listening…</span>
        )}
      </div>
    </div>
  )
}

function MeetingFeed({
  segments,
  echoCount
}: {
  segments: TranscriptSegment[]
  echoCount: number
}): React.JSX.Element | null {
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [segments])

  if (segments.length === 0) return null
  const base = Math.min(...segments.map(segmentTime))

  return (
    <div className="feed">
      <div className="feed-title">
        meeting feed
        {echoCount > 0 && <span className="feed-echo"> · {echoCount} echo suppressed</span>}
      </div>
      <div className="feed-body" ref={feedRef}>
        {segments.map((s) => (
          <div key={s.id} className={`feed-row feed-${s.channel}`}>
            <span className="feed-time">{formatOffset(segmentTime(s) - base)}</span>
            <span className="feed-speaker">{s.speaker}</span>
            <span className="feed-text">{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DevConsole(): React.JSX.Element {
  const [filePath, setFilePath] = useState('')
  const [state, dispatch] = useReducer(reducer, initialState)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // onEvent returns its unsubscribe function, which doubles as effect cleanup.
  useEffect(() => window.engine.onEvent(dispatch), [])

  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.finals, state.partial])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.log])

  const trimmedPath = filePath.trim()
  const canStartFile = trimmedPath.length > 0 && !state.running

  const start = (command: EngineCommand): void => {
    if (command === 'live') {
      window.engine.start('live', undefined, { source: 'both' })
      return
    }
    // Stream runs with --realtime so partials arrive paced like a live meeting.
    window.engine.start(command, trimmedPath, command === 'stream' ? { realtime: true } : undefined)
  }

  const lastFinal = state.finals.length > 0 ? state.finals[state.finals.length - 1] : undefined
  const hasTranscript = state.finals.length > 0 || state.partial.length > 0

  return (
    <div className="dev-dark app">
      <header>
        <h1>DoodleNote — engine dev console</h1>
      </header>

      <div className="controls">
        <input
          type="text"
          spellCheck={false}
          placeholder="/absolute/path/to/audio.wav"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canStartFile) start('stream')
          }}
        />
        <button type="button" disabled={!canStartFile} onClick={() => start('stream')}>
          Stream
        </button>
        <button type="button" disabled={!canStartFile} onClick={() => start('transcribe')}>
          Transcribe
        </button>
        <button
          type="button"
          className="live"
          disabled={state.running}
          onClick={() => start('live')}
        >
          ● Live
        </button>
        <button
          type="button"
          className="stop"
          disabled={!state.running}
          onClick={() => window.engine.stop()}
        >
          Stop
        </button>
      </div>

      <div className={`status status-${state.statusKind}`}>
        <span className="dot" />
        <span className="status-text">{state.statusText}</span>
      </div>

      {state.mode === 'live' ? (
        <>
          <div className="live-grid">
            {LIVE_CHANNELS.map((channel) => (
              <LivePane
                key={channel}
                channel={channel}
                finalText={state.liveFinals[channel]}
                partialText={state.livePartials[channel]}
              />
            ))}
          </div>
          <MeetingFeed segments={state.segments} echoCount={state.echoCount} />
        </>
      ) : (
        <>
          <div className="transcript" ref={transcriptRef}>
            {!hasTranscript && <span className="placeholder">transcript will appear here…</span>}
            {state.finals.map((f, i) => (
              <p key={i} className="final-text">
                {f.text}
              </p>
            ))}
            {state.partial && <p className="partial">{state.partial}</p>}
          </div>
          {lastFinal && <FinalMeta final={lastFinal} />}
        </>
      )}

      <details className="raw-log">
        <summary>raw events ({state.log.length})</summary>
        <div className="log-body" ref={logRef}>
          {state.log.map((entry) => (
            <div key={entry.id} className="log-line">
              <span className="log-ts">{entry.ts}</span> {entry.text}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

export default DevConsole
