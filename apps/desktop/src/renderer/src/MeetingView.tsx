import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import type { EngineChannel, EngineEvent, TranscriptSegment } from '../../shared/engine-events'
import type { MeetingRecord } from '../../shared/meetings-api'
import type { NotesModelsResponse, NotesSettingsView } from '../../shared/notes-api'
import { docToMarkdown, markdownToHtml } from './lib/markdown'

type Phase = 'idle' | 'starting' | 'recording' | 'finishing' | 'ended'

interface SessionState {
  phase: Phase
  statusText: string
  segments: TranscriptSegment[]
  partials: Partial<Record<EngineChannel, string>>
  echoCount: number
  error: string | null
}

const initialSessionState: SessionState = {
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

function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function sessionReducer(state: SessionState, ev: EngineEvent): SessionState {
  const active = ACTIVE_PHASES.includes(state.phase)
  switch (ev.event) {
    case 'started':
      if (ev.command !== 'live') {
        // A file run from the dev console superseded any live session.
        return active ? { ...state, phase: 'idle', statusText: '' } : state
      }
      return { ...initialSessionState, phase: 'starting', statusText: 'Starting…' }
    case 'status': {
      if (!active) return state
      if (ev.stage === 'requesting_permission') {
        const which = (ev.permission ?? 'capture').replace(/_/g, ' ')
        return { ...state, statusText: `Waiting for macOS permission — ${which}` }
      }
      return { ...state, statusText: (ev.stage ?? 'working').replace(/_/g, ' ') }
    }
    case 'ready':
      if (!active) return state
      return { ...state, phase: 'recording', statusText: '' }
    case 'partial':
      if (!active || !ev.channel) return state
      return { ...state, partials: { ...state.partials, [ev.channel]: ev.text } }
    case 'segments': {
      // Never attribute segments to a meeting whose view didn't run a session.
      if (state.phase === 'idle') return state
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
        statusText: 'Finishing up…',
        partials: { ...state.partials, [ev.channel]: undefined }
      }
    case 'done':
      if (!active) return state
      return { ...state, phase: 'ended', statusText: '', partials: {} }
    case 'session-saved':
      if (!active && state.phase !== 'ended') return state
      return { ...state, phase: 'ended', statusText: '', partials: {} }
    case 'error':
      return { ...state, error: ev.message }
    case 'spawn-error':
      return { ...state, phase: 'idle', statusText: '', error: ev.message }
    case 'exit': {
      if (!active) return state
      if (ev.code !== null && ev.code !== 0 && state.phase === 'starting') {
        return { ...state, phase: 'idle', statusText: '', error: `Engine exited (code ${ev.code})` }
      }
      return {
        ...state,
        phase: state.segments.length > 0 || state.phase !== 'starting' ? 'ended' : 'idle',
        statusText: '',
        partials: {}
      }
    }
    default:
      return state
  }
}

type EnhanceStatus = 'idle' | 'running' | 'error'

const CHANNEL_SPEAKERS: Record<EngineChannel, string> = { mic: 'You', system: 'Them' }

function BarsIcon({ animated }: { animated: boolean }): React.JSX.Element {
  return (
    <span className={animated ? 'bars-icon live' : 'bars-icon'} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

/** The Granola-shaped note editor: title, chips, page-wide TipTap doc,
 *  floating record/enhance bar and the transcript flyout. */
export default function MeetingView({
  meetingId,
  visible,
  autoRecord,
  onAutoRecordStarted,
  onBack,
  onOpenSettings
}: {
  meetingId: string
  visible: boolean
  /** True when this meeting was just created via "+ New meeting" — recording starts automatically. */
  autoRecord: boolean
  onAutoRecordStarted: () => void
  onBack: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null)
  const [title, setTitle] = useState('')
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState)
  const [savedSegments, setSavedSegments] = useState<TranscriptSegment[]>([])
  const [savedEcho, setSavedEcho] = useState(0)
  const [enhancedMarkdown, setEnhancedMarkdown] = useState<string | null>(null)
  const [docView, setDocView] = useState<'notes' | 'enhanced'>('notes')
  const [enhanceStatus, setEnhanceStatus] = useState<EnhanceStatus>('idle')
  const [enhanceStreamed, setEnhanceStreamed] = useState('')
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [copied, setCopied] = useState(false)
  const [emptyNotice, setEmptyNotice] = useState(false)
  const [modelsInfo, setModelsInfo] = useState<NotesModelsResponse | null>(null)
  const [settings, setSettings] = useState<NotesSettingsView | null>(null)

  const roughMarkdownRef = useRef('')
  const titleValueRef = useRef('')
  const docViewRef = useRef<'notes' | 'enhanced'>('notes')
  const applyingRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  const startedAtRef = useRef<string | null>(null)
  const recordStartRef = useRef<number | null>(null)
  const autoOpenedRef = useRef(false)
  const contentLoadedRef = useRef(false)
  const feedRef = useRef<HTMLDivElement>(null)

  // Mirror the latest session state for the engine-event handler (which
  // must read it outside the render cycle, e.g. when a new session starts).
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const persist = useCallback(
    (patch: Partial<Omit<MeetingRecord, 'id'>>): void => {
      void window.meetings.upsert({ id: meetingId, ...patch }).catch(() => {})
    },
    [meetingId]
  )

  const scheduleNotesSave = useCallback((): void => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      persist({ title: titleValueRef.current, rawNotesMarkdown: roughMarkdownRef.current })
    }, 700)
  }, [persist])

  const flushNotesSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    persist({ title: titleValueRef.current, rawNotesMarkdown: roughMarkdownRef.current })
  }, [persist])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write notes…' })
    ],
    onUpdate: ({ editor: ed }) => {
      if (applyingRef.current || docViewRef.current !== 'notes') return
      roughMarkdownRef.current = docToMarkdown(ed.getJSON())
      scheduleNotesSave()
    }
  })

  const setEditorMarkdown = useCallback(
    (markdown: string, editable: boolean): void => {
      if (!editor) return
      applyingRef.current = true
      editor.commands.setContent(markdownToHtml(markdown))
      editor.setEditable(editable)
      applyingRef.current = false
    },
    [editor]
  )

  /* ---- load the meeting document once ---- */

  useEffect(() => {
    let cancelled = false
    void window.meetings.get(meetingId).then((record) => {
      if (cancelled || !record) return
      setMeeting(record)
      setTitle(record.title)
      titleValueRef.current = record.title
      roughMarkdownRef.current = record.rawNotesMarkdown
      setSavedSegments(record.segments.filter((s) => !s.echo))
      setSavedEcho(record.echoSuppressed)
      startedAtRef.current = record.startedAt ?? null
      if (record.enhancedMarkdown) setEnhancedMarkdown(record.enhancedMarkdown)
    })
    return () => {
      cancelled = true
    }
  }, [meetingId])

  useEffect(() => {
    if (!editor || !meeting || contentLoadedRef.current) return
    contentLoadedRef.current = true
    if (meeting.enhancedMarkdown) {
      // One-time init from the loaded document; runs exactly once per mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDocView('enhanced')
      docViewRef.current = 'enhanced'
      setEditorMarkdown(meeting.enhancedMarkdown, false)
    } else {
      setEditorMarkdown(meeting.rawNotesMarkdown, true)
    }
  }, [editor, meeting, setEditorMarkdown])

  /* ---- engine events ---- */

  useEffect(
    () =>
      window.engine.onEvent((ev) => {
        if (ev.event === 'started' && ev.command === 'live') {
          // Fold the previous session's segments into the saved pool before
          // the reducer resets, so nothing is lost across re-records.
          const prev = stateRef.current
          if (prev.segments.length > 0) {
            setSavedSegments((s) => [...s, ...prev.segments])
          }
          if (prev.echoCount > 0) setSavedEcho((n) => n + prev.echoCount)
          recordStartRef.current = null
          setElapsedSec(0)
          if (!autoOpenedRef.current) {
            autoOpenedRef.current = true
            setTranscriptOpen(true)
          }
        }
        dispatch(ev)
      }),
    []
  )

  useEffect(
    () =>
      window.notes.onEnhanceToken(({ token }) => {
        setEnhanceStreamed((s) => s + token)
      }),
    []
  )

  /* ---- models / settings meta (drives the Enhance chip) ---- */

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
    if (visible) refreshNotesMeta()
  }, [visible, refreshNotesMeta])

  /* ---- recording timer ---- */

  const phase = state.phase
  const capturing = ACTIVE_PHASES.includes(phase)

  useEffect(() => {
    if (phase !== 'recording') return
    if (recordStartRef.current === null) recordStartRef.current = Date.now()
    const started = recordStartRef.current
    const tick = (): void => setElapsedSec((Date.now() - started) / 1000)
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [phase])

  /* ---- persist segments once the session lands ---- */

  const allSegments = useMemo(
    () => [...savedSegments, ...state.segments].sort((a, b) => segmentTime(a) - segmentTime(b)),
    [savedSegments, state.segments]
  )

  useEffect(() => {
    if (phase !== 'ended') return
    if (sessionSaveTimerRef.current !== null) clearTimeout(sessionSaveTimerRef.current)
    // No cleanup on unmount: the timeout only persists (no setState), so
    // letting it fire after the view is gone still lands the final flush.
    sessionSaveTimerRef.current = setTimeout(() => {
      sessionSaveTimerRef.current = null
      persist({
        segments: allSegments,
        echoSuppressed: savedEcho + state.echoCount,
        endedAt: new Date().toISOString()
      })
    }, 400)
  }, [phase, allSegments, savedEcho, state.echoCount, persist])

  // A session that ends with zero transcript is otherwise indistinguishable
  // from success ("I hit stop and nothing happened") — say so explicitly.
  useEffect(() => {
    if (phase === 'starting' || phase === 'recording') setEmptyNotice(false)
    else if (phase === 'ended' && allSegments.length === 0) setEmptyNotice(true)
  }, [phase, allSegments.length])

  // Flush pending note edits when leaving the view entirely.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current)
        persist({ title: titleValueRef.current, rawNotesMarkdown: roughMarkdownRef.current })
      }
    }
  }, [persist])

  /* ---- transcript autoscroll ---- */

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [allSegments, state.partials, transcriptOpen])

  /* ---- actions ---- */

  const startRecording = (): void => {
    if (capturing) return
    if (startedAtRef.current === null) {
      startedAtRef.current = new Date().toISOString()
      persist({ startedAt: startedAtRef.current })
    }
    window.engine.start('live', undefined, { source: 'both' })
  }

  const stopRecording = (): void => window.engine.stop()

  // Auto-start recording for meetings created via "+ New meeting": the page
  // loads already capturing (bars animate, stop button shown), so there is
  // no separate "now find the record button" step.
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (!autoRecord || !visible || autoStartedRef.current) return
    if (phase !== 'idle') return
    autoStartedRef.current = true
    onAutoRecordStarted()
    startRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when eligible
  }, [autoRecord, visible, phase])

  const totalEcho = savedEcho + state.echoCount
  const anyDownloaded = modelsInfo?.models.some((m) => m.downloaded) ?? false
  const cloudReady = settings?.engineChoice === 'cloud' && settings.cloud?.hasKey === true
  const modelReady = cloudReady || anyDownloaded
  const canEnhance = allSegments.length > 0 && modelReady && enhanceStatus !== 'running'

  const runEnhance = async (): Promise<void> => {
    if (!editor || enhanceStatus === 'running') return
    refreshNotesMeta()
    setEnhanceError(null)
    setEnhanceStatus('running')
    setEnhanceStreamed('')
    // Make sure the freshest rough notes go into the merge.
    if (docViewRef.current === 'notes') {
      roughMarkdownRef.current = docToMarkdown(editor.getJSON())
    }
    const result = await window.notes.enhance({
      title: titleValueRef.current.trim() || 'New meeting',
      rawNotesMarkdown: roughMarkdownRef.current,
      segments: allSegments
    })
    if (result.error !== undefined || result.markdown === undefined) {
      setEnhanceStatus('error')
      setEnhanceError(result.error ?? 'Enhance failed with no output')
      return
    }
    setEnhanceStatus('idle')
    setEnhancedMarkdown(result.markdown)
    persist({
      enhancedMarkdown: result.markdown,
      ...(result.engine ? { engine: result.engine } : {})
    })
    setDocView('enhanced')
    docViewRef.current = 'enhanced'
    setEditorMarkdown(result.markdown, false)
  }

  const showNotesDoc = (): void => {
    if (docView === 'notes') return
    setDocView('notes')
    docViewRef.current = 'notes'
    setEditorMarkdown(roughMarkdownRef.current, true)
  }

  const showEnhancedDoc = (): void => {
    if (docView === 'enhanced' || enhancedMarkdown === null) return
    // Capture any rough edits before swapping documents.
    if (editor && docViewRef.current === 'notes') {
      roughMarkdownRef.current = docToMarkdown(editor.getJSON())
      flushNotesSave()
    }
    setDocView('enhanced')
    docViewRef.current = 'enhanced'
    setEditorMarkdown(enhancedMarkdown, false)
  }

  const copyTranscript = (): void => {
    const text = allSegments.map((s) => `${s.speaker}: ${s.text}`).join('\n')
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const goBack = (): void => {
    flushNotesSave()
    onBack()
  }

  /* ---- derived display bits ---- */

  const createdAt = meeting?.createdAt
  const dateChip = useMemo(() => {
    if (!createdAt) return 'Today'
    const d = new Date(createdAt)
    const today = new Date()
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    return sameDay
      ? 'Today'
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  }, [createdAt])

  const streamedWords = enhanceStreamed.length > 0 ? enhanceStreamed.trim().split(/\s+/).length : 0
  const transcriptEmpty = allSegments.length === 0 && Object.values(state.partials).every((p) => !p)
  const firstSegmentTime = allSegments.length > 0 ? segmentTime(allSegments[0]!) : 0

  return (
    <div className="editor-page">
      <div className="editor-topbar drag">
        <button type="button" className="back-pill no-drag" onClick={goBack} title="Back to home">
          ‹ ⌂
        </button>
      </div>

      {state.error && (
        <div className="toast" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => dispatch({ event: 'error', message: '' })}>
            ✕
          </button>
        </div>
      )}

      {emptyNotice && !state.error && (
        <div className="toast" role="status">
          <span>
            Recording ended, but no speech was transcribed on either channel. Try again speaking
            near the mic (or with meeting audio playing) — if it keeps happening, the Developer
            view shows the raw engine events.
          </span>
          <button type="button" onClick={() => setEmptyNotice(false)}>
            ✕
          </button>
        </div>
      )}

      <div className="editor-scroll">
        <div className="editor-col">
          <input
            className="doc-title"
            type="text"
            spellCheck={false}
            placeholder="New meeting"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              titleValueRef.current = e.target.value
              scheduleNotesSave()
            }}
          />

          <div className="chips-row">
            <span className="chip">📅 {dateChip}</span>
            <span className="chip">👥 Me</span>
            {enhancedMarkdown !== null && (
              <span className="chip chip-toggle">
                <button
                  type="button"
                  className={docView === 'notes' ? 'on' : ''}
                  onClick={showNotesDoc}
                >
                  My notes
                </button>
                <button
                  type="button"
                  className={docView === 'enhanced' ? 'on' : ''}
                  onClick={showEnhancedDoc}
                >
                  Enhanced ✓
                </button>
              </span>
            )}
          </div>

          <EditorContent editor={editor} className="doc-editor" />
        </div>
      </div>

      {transcriptOpen && (
        <div className="transcript-panel">
          <div className="tp-head">
            <span className="tp-meta">{totalEcho > 0 ? `${totalEcho} echo suppressed` : ''}</span>
            <div className="tp-actions">
              <button type="button" onClick={copyTranscript} title="Copy transcript">
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setTranscriptOpen(false)}
                title="Minimize"
                aria-label="Minimize transcript"
              >
                —
              </button>
            </div>
          </div>
          <div className="tp-body" ref={feedRef}>
            {transcriptEmpty ? (
              <div className="tp-empty">
                <p className="tp-empty-title">Transcript on…</p>
                <p className="tp-empty-sub">
                  {capturing ? 'Start talking' : 'Hit record and start talking'}
                </p>
              </div>
            ) : (
              <>
                {allSegments.map((s) => (
                  <div key={s.id} className={`tp-row tp-${s.channel}`}>
                    <span className="tp-speaker">{s.speaker}</span>
                    <span className="tp-text">{s.text}</span>
                    <span className="tp-time">
                      {formatClock((segmentTime(s) - firstSegmentTime) / 1000)}
                    </span>
                  </div>
                ))}
                {capturing &&
                  (['mic', 'system'] as const).map((channel) =>
                    state.partials[channel] ? (
                      <div key={channel} className={`tp-row tp-${channel} tp-partial`}>
                        <span className="tp-speaker">{CHANNEL_SPEAKERS[channel]}</span>
                        <span className="tp-text">{state.partials[channel]}</span>
                        <span className="tp-time">·</span>
                      </div>
                    ) : null
                  )}
              </>
            )}
          </div>
          <div className="tp-foot">Always get consent when recording others.</div>
        </div>
      )}

      {enhanceStatus === 'error' && enhanceError && (
        <div className="enhance-error-bar">
          <span>{enhanceError}</span>
          {!modelReady && (
            <button type="button" onClick={onOpenSettings}>
              Open Settings →
            </button>
          )}
          <button type="button" onClick={() => setEnhanceStatus('idle')}>
            Dismiss
          </button>
        </div>
      )}

      <div className="bottom-bar">
        <div className="rec-pill">
          {capturing ? (
            <>
              <span className="rec-live">
                <BarsIcon animated={phase === 'recording'} />
                <span className="rec-timer">
                  {phase === 'recording' ? formatClock(elapsedSec) : state.statusText || '…'}
                </span>
              </span>
              <button
                type="button"
                className="chev-btn"
                onClick={() => setTranscriptOpen((v) => !v)}
                title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
              >
                {transcriptOpen ? '⌄' : '⌃'}
              </button>
              <button
                type="button"
                className="stop-btn"
                onClick={stopRecording}
                title="Stop recording"
                aria-label="Stop recording"
              >
                ■
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="record-btn"
                onClick={startRecording}
                title="Start recording"
              >
                <BarsIcon animated={false} />
              </button>
              <button
                type="button"
                className="chev-btn"
                onClick={() => setTranscriptOpen((v) => !v)}
                title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
              >
                {transcriptOpen ? '⌄' : '⌃'}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className="enhance-chip"
          disabled={!canEnhance}
          title={
            !modelReady
              ? 'Activate a notes model in Settings first'
              : allSegments.length === 0
                ? 'Record the meeting first'
                : enhancedMarkdown !== null
                  ? 'Re-enhance notes'
                  : 'Enhance notes'
          }
          onClick={() => void runEnhance()}
        >
          {enhanceStatus === 'running' ? (
            <>
              <span className="spinner" aria-hidden="true" />
              {streamedWords > 0 ? `Writing… ${streamedWords} words` : 'Enhancing…'}
            </>
          ) : (
            <>✨ {enhancedMarkdown !== null ? 'Re-enhance notes' : 'Enhance notes'}</>
          )}
        </button>
      </div>
    </div>
  )
}
