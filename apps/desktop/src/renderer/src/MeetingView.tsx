import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import type { EngineChannel, EngineEvent, TranscriptSegment } from '../../shared/engine-events'
import type { NotesModelsResponse, NotesSettingsView } from '../../shared/notes-api'
import { docToMarkdown, markdownToHtml } from './lib/markdown'

type Phase = 'idle' | 'starting' | 'recording' | 'finishing' | 'ended'

interface MeetingState {
  phase: Phase
  statusText: string
  segments: TranscriptSegment[]
  partials: Partial<Record<EngineChannel, string>>
  echoCount: number
  error: string | null
}

const initialMeetingState: MeetingState = {
  phase: 'idle',
  statusText: '',
  segments: [],
  partials: {},
  echoCount: 0,
  error: null
}

const ACTIVE_PHASES: readonly Phase[] = ['starting', 'recording', 'finishing']

function segmentTime(segment: TranscriptSegment): number {
  return segment.absoluteStartMs ?? segment.startMs
}

function formatOffset(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

function meetingReducer(state: MeetingState, ev: EngineEvent): MeetingState {
  const active = ACTIVE_PHASES.includes(state.phase)
  switch (ev.event) {
    case 'started':
      if (ev.command !== 'live') {
        // A file run from the dev console superseded any live session.
        return active ? { ...state, phase: 'idle', statusText: '' } : state
      }
      return {
        ...initialMeetingState,
        phase: 'starting',
        statusText: 'starting live capture…'
      }
    case 'status': {
      if (!active) return state
      if (ev.stage === 'requesting_permission') {
        const which = (ev.permission ?? 'capture').replace(/_/g, ' ')
        return { ...state, statusText: `waiting for macOS permission — ${which}` }
      }
      return { ...state, statusText: (ev.stage ?? 'working').replace(/_/g, ' ') }
    }
    case 'ready':
      if (!active) return state
      return {
        ...state,
        phase: 'recording',
        statusText: `listening (${(ev.channels ?? []).join(' + ') || 'live'})`
      }
    case 'partial':
      if (!active || !ev.channel) return state
      return { ...state, partials: { ...state.partials, [ev.channel]: ev.text } }
    case 'segments': {
      const kept = ev.segments.filter((s) => !s.echo)
      const echoDropped = ev.segments.length - kept.length
      if (kept.length === 0 && echoDropped === 0) return state
      const merged = [...state.segments, ...kept].sort((a, b) => segmentTime(a) - segmentTime(b))
      return { ...state, segments: merged, echoCount: state.echoCount + echoDropped }
    }
    case 'final':
      if (!active || !ev.channel) return state
      return {
        ...state,
        phase: 'finishing',
        statusText: `finalizing… (${ev.channel} done)`,
        partials: { ...state.partials, [ev.channel]: undefined }
      }
    case 'done':
      if (!active) return state
      return { ...state, phase: 'ended', statusText: 'meeting ended', partials: {} }
    case 'session-saved':
      if (!active && state.phase !== 'ended') return state
      return {
        ...state,
        phase: 'ended',
        statusText: `meeting ended — ${ev.segmentCount} segments saved`,
        partials: {}
      }
    case 'error':
      return { ...state, error: ev.message }
    case 'spawn-error':
      return { ...state, phase: 'idle', statusText: '', error: ev.message }
    case 'exit': {
      if (!active) return state
      if (ev.code !== null && ev.code !== 0 && state.phase === 'starting') {
        return {
          ...state,
          phase: 'idle',
          statusText: '',
          error: `engine exited with code ${ev.code}`
        }
      }
      return {
        ...state,
        phase: state.segments.length > 0 || state.phase !== 'starting' ? 'ended' : 'idle',
        statusText: state.statusText || 'meeting ended',
        partials: {}
      }
    }
    default:
      return state
  }
}

type EnhanceStatus = 'idle' | 'need-model' | 'running' | 'done' | 'error'

interface EnhanceState {
  status: EnhanceStatus
  streamed: string
  markdown?: string
  engine?: string
  elapsedMs?: number
  error?: string
}

const CHANNEL_SPEAKERS: Record<EngineChannel, string> = { mic: 'You', system: 'Them' }

export default function MeetingView({
  active,
  onOpenModels
}: {
  active: boolean
  onOpenModels: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('Untitled meeting')
  const [state, dispatch] = useReducer(meetingReducer, initialMeetingState)
  const [modelsInfo, setModelsInfo] = useState<NotesModelsResponse | null>(null)
  const [settings, setSettings] = useState<NotesSettingsView | null>(null)
  const [enhance, setEnhance] = useState<EnhanceState>({ status: 'idle', streamed: '' })
  const [rightPane, setRightPane] = useState<'transcript' | 'enhanced'>('transcript')
  const [copied, setCopied] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const enhancedRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Jot rough notes during the meeting…' })
    ]
  })

  useEffect(
    () =>
      window.engine.onEvent((ev) => {
        // A fresh live session clears the previous enhance output.
        if (ev.event === 'started' && ev.command === 'live') {
          setEnhance({ status: 'idle', streamed: '' })
          setRightPane('transcript')
          setCopied(false)
        }
        dispatch(ev)
      }),
    []
  )

  useEffect(
    () =>
      window.notes.onEnhanceToken(({ token }) => {
        setEnhance((e) => (e.status === 'running' ? { ...e, streamed: e.streamed + token } : e))
      }),
    []
  )

  const refreshNotesMeta = useCallback(() => {
    void window.notes
      .models()
      .then(setModelsInfo)
      .catch(() => setModelsInfo(null))
    void window.notes
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    if (active) refreshNotesMeta()
  }, [active, refreshNotesMeta])

  const phase = state.phase

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.segments, state.partials])

  useEffect(() => {
    const el = enhancedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [enhance.streamed])

  const capturing = ACTIVE_PHASES.includes(phase)
  const anyDownloaded = modelsInfo?.models.some((m) => m.downloaded) ?? false
  const effectiveEngine =
    settings?.engineChoice === 'cloud' && settings.cloud?.hasKey ? 'cloud' : 'local'
  const needsModel = effectiveEngine === 'local' && modelsInfo !== null && !anyDownloaded

  const runEnhance = async (): Promise<void> => {
    if (!editor || enhance.status === 'running') return
    refreshNotesMeta()
    if (needsModel) {
      setEnhance({ status: 'need-model', streamed: '' })
      setRightPane('enhanced')
      return
    }
    setEnhance({ status: 'running', streamed: '' })
    setRightPane('enhanced')
    setCopied(false)
    const result = await window.notes.enhance({
      title: title.trim() || 'Untitled meeting',
      rawNotesMarkdown: docToMarkdown(editor.getJSON()),
      segments: state.segments
    })
    if (result.error !== undefined || result.markdown === undefined) {
      setEnhance((e) => ({
        ...e,
        status: 'error',
        error: result.error ?? 'enhance failed with no output'
      }))
      return
    }
    setEnhance((e) => ({
      ...e,
      status: 'done',
      markdown: result.markdown,
      engine: result.engine,
      elapsedMs: result.elapsedMs
    }))
  }

  const copyEnhanced = (): void => {
    if (enhance.markdown === undefined) return
    void navigator.clipboard.writeText(enhance.markdown).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const hasEnhancedPane = enhance.status !== 'idle'
  const showEnhanced = rightPane === 'enhanced' && hasEnhancedPane

  return (
    <div className="meeting">
      {needsModel && (
        <div className="banner">
          <span>
            Download a notes model to enable <strong>✨ Enhance</strong> — everything runs
            on-device.
          </span>
          <button type="button" onClick={onOpenModels}>
            Open Models →
          </button>
        </div>
      )}

      <div className="meeting-header">
        <input
          className="meeting-title"
          type="text"
          spellCheck={false}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        {capturing ? (
          <button type="button" className="stop" onClick={() => window.engine.stop()}>
            ■ Stop
          </button>
        ) : (
          <button
            type="button"
            className="record"
            onClick={() => window.engine.start('live', undefined, { source: 'both' })}
          >
            ● Start
          </button>
        )}
        {state.statusText && <span className="meeting-status">{state.statusText}</span>}
        {state.error && <span className="meeting-error">{state.error}</span>}
      </div>

      <div className="meeting-columns">
        <section className="meeting-col">
          <div className="col-title-row">
            <span className="col-title">My notes</span>
          </div>
          <EditorContent editor={editor} className="notes-editor" />
        </section>

        <section className="meeting-col">
          <div className="col-title-row">
            <span className="col-title">{showEnhanced ? 'Enhanced notes' : 'Transcript'}</span>
            {hasEnhancedPane && (
              <span className="pane-toggle">
                <button
                  type="button"
                  className={rightPane === 'transcript' ? 'on' : ''}
                  onClick={() => setRightPane('transcript')}
                >
                  transcript
                </button>
                <button
                  type="button"
                  className={rightPane === 'enhanced' ? 'on' : ''}
                  onClick={() => setRightPane('enhanced')}
                >
                  enhanced
                </button>
              </span>
            )}
            {!showEnhanced && state.echoCount > 0 && (
              <span className="feed-echo">{state.echoCount} echo suppressed</span>
            )}
          </div>

          {showEnhanced ? (
            <div className="enhanced-pane">
              {enhance.status === 'need-model' && (
                <div className="enhanced-prompt">
                  <p>
                    No notes model is downloaded yet. Doodle Note enhances notes fully on-device —
                    download a model once and Enhance works offline forever.
                  </p>
                  <button type="button" onClick={onOpenModels}>
                    Open Models →
                  </button>
                </div>
              )}
              {enhance.status === 'running' && (
                <div className="enhanced-stream" ref={enhancedRef}>
                  {enhance.streamed.length > 0 ? (
                    <pre>{enhance.streamed}</pre>
                  ) : (
                    <span className="placeholder">thinking…</span>
                  )}
                  <span className="cursor">▋</span>
                </div>
              )}
              {enhance.status === 'error' && (
                <div className="enhanced-prompt">
                  <p className="enhanced-error">{enhance.error}</p>
                  <button type="button" onClick={() => void runEnhance()}>
                    Try again
                  </button>
                </div>
              )}
              {enhance.status === 'done' && enhance.markdown !== undefined && (
                <>
                  <div
                    className="enhanced-body md-render"
                    // Escaped before tags are added in markdownToHtml — inert HTML.
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(enhance.markdown) }}
                  />
                  <div className="enhanced-meta">
                    <span>
                      {enhance.engine ?? 'engine'} · {((enhance.elapsedMs ?? 0) / 1000).toFixed(1)}s
                    </span>
                    <button type="button" onClick={copyEnhanced}>
                      {copied ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="feed-body meeting-feed" ref={feedRef}>
              {state.segments.length === 0 && Object.values(state.partials).every((p) => !p) && (
                <span className="placeholder">
                  {capturing
                    ? 'listening — the transcript appears here…'
                    : 'transcript appears here once the meeting starts'}
                </span>
              )}
              {state.segments.map((s, _i, all) => {
                const base = segmentTime(all[0]!)
                return (
                  <div key={s.id} className={`feed-row feed-${s.channel}`}>
                    <span className="feed-time">{formatOffset(segmentTime(s) - base)}</span>
                    <span className="feed-speaker">{s.speaker}</span>
                    <span className="feed-text">{s.text}</span>
                  </div>
                )
              })}
              {capturing &&
                (['mic', 'system'] as const).map((channel) =>
                  state.partials[channel] ? (
                    <div key={channel} className={`feed-row feed-${channel} feed-partial`}>
                      <span className="feed-time">·</span>
                      <span className="feed-speaker">{CHANNEL_SPEAKERS[channel]}</span>
                      <span className="feed-text">{state.partials[channel]}</span>
                    </div>
                  ) : null
                )}
            </div>
          )}
        </section>
      </div>

      {phase === 'ended' && (
        <div className="enhance-bar">
          <button
            type="button"
            className="enhance"
            disabled={enhance.status === 'running'}
            onClick={() => void runEnhance()}
          >
            {enhance.status === 'running'
              ? 'Enhancing…'
              : enhance.status === 'done'
                ? '✨ Re-enhance notes'
                : '✨ Enhance notes'}
          </button>
          {enhance.status === 'done' && rightPane === 'transcript' && (
            <button type="button" onClick={() => setRightPane('enhanced')}>
              view enhanced notes
            </button>
          )}
        </div>
      )}
    </div>
  )
}
