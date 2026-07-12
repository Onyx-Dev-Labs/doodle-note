import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import type {
  EngineChannel,
  EngineEvent,
  EngineInputDevice,
  TranscriptSegment
} from '../../shared/engine-events'
import { AUDIO_PERSIST_STORAGE_KEY, type AudioPart } from '../../shared/audio-api'
import type { FolderRecord } from '../../shared/folders-api'
import type { MeetingChatEntry, MeetingRecord } from '../../shared/meetings-api'
import type {
  NotesModelsResponse,
  NotesSettingsView,
  NotesTemplateInfo
} from '../../shared/notes-api'
import FolderPicker from './FolderPicker'
import DoodlingIndicator from './DoodlingIndicator'
import FormatToolbar from './FormatToolbar'
import {
  CalendarIcon,
  FolderIcon,
  HomeIcon,
  MailIcon,
  PencilIcon,
  SparkleIcon,
  UsersIcon
} from './icons'
import { docToMarkdown, markdownToHtml } from './lib/markdown'

type Phase = 'idle' | 'starting' | 'recording' | 'finishing' | 'ended'

interface SessionState {
  phase: Phase
  statusText: string
  segments: TranscriptSegment[]
  partials: Partial<Record<EngineChannel, string>>
  echoCount: number
  error: string | null
  /** True once the ASR models finished warming and transcription is live. */
  transcribing: boolean
}

const initialSessionState: SessionState = {
  phase: 'idle',
  statusText: '',
  segments: [],
  partials: {},
  echoCount: 0,
  error: null,
  transcribing: false
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
      if (ev.stage === 'transcribing') {
        return { ...state, transcribing: true, statusText: '' }
      }
      // The engine confirms a stop instantly with `finishing` — reflect it
      // instantly, or the still-ticking timer makes stop look ignored and
      // users hammer the button.
      if (ev.stage === 'finishing' || ev.stage === 'saving_audio') {
        return { ...state, phase: 'finishing', statusText: 'Finishing up…' }
      }
      return { ...state, statusText: (ev.stage ?? 'working').replace(/_/g, ' ') }
    }
    case 'ready':
      if (!active) return state
      return { ...state, phase: 'recording', statusText: '' }
    case 'partial':
      if (!active || !ev.channel) return state
      return { ...state, transcribing: true, partials: { ...state.partials, [ev.channel]: ev.text } }
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

/** Remembered mic choice ('' = system default input). */
const INPUT_DEVICE_STORAGE_KEY = 'doodle.inputDeviceUid'

function MicIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Canned question behind the "✉ Write follow up email" chip. */
const FOLLOW_UP_EMAIL_QUESTION =
  'Write a concise, ready-to-send follow-up email for this meeting: brief recap, decisions made, and action items with owners.'

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

/** The image files in a paste/drop/pick payload (other file types ignored). */
function imageFilesFrom(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
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
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  /** "Condensing part 2 of 5…" during long-meeting map-reduce; null = whimsy. */
  const [enhanceProgressText, setEnhanceProgressText] = useState<string | null>(null)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatThread, setChatThread] = useState<MeetingChatEntry[]>([])
  const [askText, setAskText] = useState('')
  /** The question currently being answered; null when no ask is in flight. */
  const [askPending, setAskPending] = useState<string | null>(null)
  const [chatCopied, setChatCopied] = useState<number | null>(null)
  const [askStreamed, setAskStreamed] = useState('')
  const [askError, setAskError] = useState<string | null>(null)
  const [askHint, setAskHint] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [copied, setCopied] = useState(false)
  const [emptyNotice, setEmptyNotice] = useState(false)
  const [modelsInfo, setModelsInfo] = useState<NotesModelsResponse | null>(null)
  const [settings, setSettings] = useState<NotesSettingsView | null>(null)
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [audioParts, setAudioParts] = useState<AudioPart[]>([])
  const [activePart, setActivePart] = useState(0)
  const [playingSegId, setPlayingSegId] = useState<string | null>(null)
  const [retranscribing, setRetranscribing] = useState(false)
  const [inputDevices, setInputDevices] = useState<EngineInputDevice[]>([])
  const [inputDeviceUid, setInputDeviceUid] = useState<string>(
    () => window.localStorage.getItem(INPUT_DEVICE_STORAGE_KEY) ?? ''
  )

  const roughMarkdownRef = useRef('')
  const titleValueRef = useRef('')
  const docViewRef = useRef<'notes' | 'enhanced'>('notes')
  const applyingRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  const startedAtRef = useRef<string | null>(null)
  const recordStartRef = useRef<number | null>(null)
  /** Seconds recorded in EARLIER sessions of this meeting — Resume must not
   *  restart the clock at 0 when the recording itself is cumulative. */
  const elapsedBaseRef = useRef(0)
  const autoOpenedRef = useRef(false)
  const contentLoadedRef = useRef(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  /** Seek (seconds) to apply once a newly selected part's metadata loads. */
  const pendingSeekSecRef = useRef<number | null>(null)
  /** Mirrors chatThread so an in-flight ask reads the freshest history. */
  const chatThreadRef = useRef<MeetingChatEntry[]>([])
  const chatFeedRef = useRef<HTMLDivElement>(null)
  const askHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  /** Pasted/dropped image files route through here (set once editor exists). */
  const insertImagesRef = useRef<(files: File[]) => void>(() => {})

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      Placeholder.configure({ placeholder: 'Write notes…' })
    ],
    editorProps: {
      // Pasted and dragged-in images persist to the local attachments store.
      handlePaste: (_view, event) => {
        const files = imageFilesFrom(event.clipboardData?.files)
        if (files.length === 0) return false
        insertImagesRef.current(files)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFilesFrom(event.dataTransfer?.files)
        if (files.length === 0) return false
        insertImagesRef.current(files)
        return true
      }
    },
    onUpdate: ({ editor: ed }) => {
      if (applyingRef.current || docViewRef.current !== 'notes') return
      roughMarkdownRef.current = docToMarkdown(ed.getJSON())
      scheduleNotesSave()
    }
  })

  useEffect(() => {
    insertImagesRef.current = (files: File[]): void => {
      if (!editor) return
      void (async () => {
        for (const file of files) {
          const bytes = await file.arrayBuffer()
          const result = await window.media.save({ bytes, mime: file.type })
          if ('url' in result) {
            editor.chain().focus().setImage({ src: result.url }).run()
          } else {
            console.error('[media] image save failed:', result.error)
          }
        }
      })()
    }
  }, [editor])

  const imageInputRef = useRef<HTMLInputElement>(null)

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
      setTemplateId(record.templateId ?? 'general')
      templateIdRef.current = record.templateId ?? 'general'
      setFolderId(record.folderId ?? null)
      if (record.enhancedMarkdown) setEnhancedMarkdown(record.enhancedMarkdown)
      if (Array.isArray(record.chat) && record.chat.length > 0) {
        chatThreadRef.current = record.chat
        setChatThread(record.chat)
      }
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
          // Resume continues the meeting clock: bank whatever the timer
          // showed when the last session ended. Max, not assignment — on a
          // freshly reopened meeting the display still reads 0 while the
          // base was seeded from the saved parts.
          setElapsedSec((shown) => {
            elapsedBaseRef.current = Math.max(elapsedBaseRef.current, shown)
            return shown
          })
          if (!autoOpenedRef.current) {
            autoOpenedRef.current = true
            setTranscriptOpen(true)
            setChatOpen(false)
          }
        }
        dispatch(ev)
      }),
    []
  )

  useEffect(
    () =>
      window.notes.onAskToken(({ token }) => {
        setAskStreamed((s) => s + token)
      }),
    []
  )

  useEffect(
    () =>
      window.notes.onEnhanceProgress((progress) => {
        setEnhanceProgressText(
          progress.phase === 'condensing' && progress.total
            ? `Long meeting — condensing part ${progress.current} of ${progress.total}…`
            : null // writing phase: back to the regular doodling phrases
        )
      }),
    []
  )

  /* ---- saved audio (local recordings; playback + transcript seek) ---- */

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      window.audio
        .list(meetingId)
        .then((parts) => {
          if (cancelled) return
          setAudioParts(parts)
          // Freshly (re)opened meeting: align the meeting clock with what's
          // already recorded, so a Resume continues rather than restarts.
          if (!ACTIVE_PHASES.includes(stateRef.current.phase)) {
            elapsedBaseRef.current = parts.reduce((sum, p) => sum + p.durationMs, 0) / 1000
          }
        })
        .catch(() => {})
    }
    refresh()
    // The engine reports "audio" once a stopped session's recording merged.
    const unsubscribe = window.engine.onEvent((ev) => {
      if (ev.event === 'audio') refresh()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [meetingId])

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

  /* ---- folder chip ---- */

  const refreshFolders = useCallback(() => {
    void window.folders
      .list()
      .then(setFolders)
      .catch(() => setFolders([]))
  }, [])

  useEffect(() => {
    if (visible) refreshFolders()
  }, [visible, refreshFolders])

  const assignFolder = useCallback(
    (nextFolderId: string | null): void => {
      setFolderPickerOpen(false)
      setFolderId(nextFolderId)
      persist({ folderId: nextFolderId })
      // The picker may have just created the folder — refresh so the chip
      // can resolve its name.
      refreshFolders()
    },
    [persist, refreshFolders]
  )

  /* ---- recording timer ---- */

  const phase = state.phase
  const capturing = ACTIVE_PHASES.includes(phase)

  /* ---- note templates ---- */

  const [templates, setTemplates] = useState<NotesTemplateInfo[]>([])
  const [templateId, setTemplateId] = useState('general')
  const templateIdRef = useRef('general')
  const [tplMenuOpen, setTplMenuOpen] = useState(false)

  useEffect(() => {
    void window.notes
      .templates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  // Close the template menu on outside click or Escape.
  useEffect(() => {
    if (!tplMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.tpl-menu') || target?.closest('.tpl-anchor')) return
      setTplMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTplMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [tplMenuOpen])

  /* ---- auto-stop when the meeting app hangs up (Granola-style) ---- */

  const [autoStopped, setAutoStopped] = useState(false)
  const capturingRef = useRef(false)
  capturingRef.current = capturing

  /** Meeting ended → after the capture settles, generate notes on their own. */
  const pendingAutoGenRef = useRef(false)

  useEffect(() => {
    return window.detect.onMeetingEnded(() => {
      if (!capturingRef.current) return
      window.engine.stop()
      setAutoStopped(true)
      pendingAutoGenRef.current = true
    })
  }, [])

  useEffect(() => {
    if (!autoStopped) return
    const timer = setTimeout(() => setAutoStopped(false), 8000)
    return () => clearTimeout(timer)
  }, [autoStopped])

  useEffect(() => {
    if (phase !== 'recording') return
    if (recordStartRef.current === null) recordStartRef.current = Date.now()
    const started = recordStartRef.current
    const base = elapsedBaseRef.current
    const tick = (): void => setElapsedSec(base + (Date.now() - started) / 1000)
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

  // When the session ends, tuck the transcript panel away so the Generate
  // notes CTA takes the stage (it renders in the space the panel covers).
  useEffect(() => {
    if (phase === 'ended') setTranscriptOpen(false)
  }, [phase])

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

  /* ---- playback follow-along: keep the highlighted row in view ---- */

  useEffect(() => {
    if (playingSegId === null) return
    feedRef.current?.querySelector('.tp-playing')?.scrollIntoView({ block: 'nearest' })
  }, [playingSegId])

  /* ---- chat autoscroll + hint timer cleanup ---- */

  useEffect(() => {
    const el = chatFeedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatThread, askPending, askStreamed, askError, chatOpen])

  useEffect(() => {
    return () => {
      if (askHintTimerRef.current !== null) clearTimeout(askHintTimerRef.current)
    }
  }, [])

  /* ---- actions ---- */

  // Mic picker: [] where unsupported (Windows), which hides the control.
  // Refreshed when the picker gains focus so plugging in a mic just works.
  const refreshInputDevices = useCallback(async (): Promise<void> => {
    try {
      setInputDevices(await window.engine.listInputDevices())
    } catch {
      setInputDevices([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.engine
      .listInputDevices()
      .then((devices) => {
        if (!cancelled) setInputDevices(devices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const changeInputDevice = (uid: string): void => {
    setInputDeviceUid(uid)
    if (uid) window.localStorage.setItem(INPUT_DEVICE_STORAGE_KEY, uid)
    else window.localStorage.removeItem(INPUT_DEVICE_STORAGE_KEY)
    // Mid-recording the engine swaps the capture under the live session.
    if (ACTIVE_PHASES.includes(stateRef.current.phase)) {
      window.engine.setInputDevice(uid || null)
    }
  }

  const startRecording = (): void => {
    if (capturing) return
    if (startedAtRef.current === null) {
      startedAtRef.current = new Date().toISOString()
      persist({ startedAt: startedAtRef.current })
    }
    // Only pin a remembered device that still exists — a stale UID (unplugged
    // since last time) records from the system default instead.
    const pinned =
      inputDeviceUid && inputDevices.some((d) => d.uid === inputDeviceUid)
        ? inputDeviceUid
        : undefined
    window.engine.start('live', undefined, {
      source: 'both',
      inputDevice: pinned,
      meetingId,
      persistAudio: window.localStorage.getItem(AUDIO_PERSIST_STORAGE_KEY) !== 'off'
    })
  }

  const stopRecording = (): void => window.engine.stop()

  /* ---- playback: transcript ↔ audio sync ---- */

  // Map a segment's wall-clock time onto (recording part, offset): the part
  // is the latest one that started at or before the segment; the offset is
  // the distance from that part's first frame.
  //
  // absoluteStartMs survives local recording but is STRIPPED by today's sync
  // schema (no column), so any meeting that round-tripped through the cloud
  // loses it. Fallback: a segment's channel-relative startMs is within the
  // capture-start gap (≈1s) of its file position in the current part.
  const seekToSegment = (segment: TranscriptSegment): void => {
    if (audioParts.length === 0) return
    let partIndex = Math.min(activePart, audioParts.length - 1)
    let offsetSec = Math.max(0, segment.startMs / 1000)
    const abs = segment.absoluteStartMs
    if (typeof abs === 'number') {
      partIndex = 0
      for (let i = audioParts.length - 1; i >= 0; i--) {
        if (audioParts[i]!.startEpochMs <= abs) {
          partIndex = i
          break
        }
      }
      offsetSec = Math.max(0, (abs - audioParts[partIndex]!.startEpochMs) / 1000)
    }
    const el = audioRef.current
    if (partIndex !== activePart || !el) {
      pendingSeekSecRef.current = offsetSec
      setActivePart(partIndex)
      return
    }
    el.currentTime = offsetSec
    void el.play()
  }

  // Rebuild the transcript from the saved recording with the current model.
  // Notes are untouched; the segment list is replaced wholesale.
  const runRetranscribe = async (): Promise<void> => {
    if (retranscribing || capturing) return
    if (
      !window.confirm(
        'Re-transcribe this meeting from its saved recording? The current transcript is replaced; your notes are kept.'
      )
    ) {
      return
    }
    setRetranscribing(true)
    try {
      const result = await window.importer.retranscribe(meetingId)
      if (result.error) {
        dispatch({ event: 'error', message: result.error })
        return
      }
      const record = await window.meetings.get(meetingId)
      if (record) {
        setSavedSegments(record.segments.filter((s) => !s.echo))
        setSavedEcho(record.echoSuppressed)
      }
    } catch (err) {
      dispatch({ event: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setRetranscribing(false)
    }
  }

  // Highlight the transcript row the playhead is inside of.
  const onPlayheadMoved = (): void => {
    const part = audioParts[activePart]
    const el = audioRef.current
    if (!part || !el || el.paused) return
    const epochMs = part.startEpochMs + el.currentTime * 1000
    let current: string | null = null
    for (const s of allSegments) {
      // Same fallback as seekToSegment for sync-stripped segments.
      const t = typeof s.absoluteStartMs === 'number' ? s.absoluteStartMs : part.startEpochMs + s.startMs
      if (t > epochMs) break
      current = s.id
    }
    setPlayingSegId(current)
  }

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
    // Make sure the freshest rough notes go into the merge.
    if (docViewRef.current === 'notes') {
      roughMarkdownRef.current = docToMarkdown(editor.getJSON())
    }
    const result = await window.notes.enhance({
      title: titleValueRef.current.trim() || 'New meeting',
      rawNotesMarkdown: roughMarkdownRef.current,
      segments: allSegments,
      templateId: templateIdRef.current
    })
    if (result.error !== undefined || result.markdown === undefined) {
      setEnhanceStatus('error')
      setEnhanceError(result.error ?? 'Enhance failed with no output')
      return
    }
    // Granola-style footer: when the meeting lives in the cloud too, the
    // notes link to its web page (full transcript + chat). Skipped while
    // sync is off — local-first notes carry no dead links.
    let markdown = result.markdown
    try {
      const sync = await window.sync.getStatus()
      if (sync.connected && sync.enabled) {
        markdown += `\n\n---\n\n[View transcript & chat](${sync.baseUrl}/app/meeting/${meetingId})`
      }
    } catch {
      // status unavailable — plain notes are fine
    }
    setEnhanceStatus('idle')
    setEnhancedMarkdown(markdown)
    persist({
      enhancedMarkdown: markdown,
      ...(result.engine ? { engine: result.engine } : {})
    })
    setDocView('enhanced')
    docViewRef.current = 'enhanced'
    setEditorMarkdown(markdown, false)
  }

  /** Pick a template: remember it on the meeting and (re)generate with it. */
  const chooseTemplate = (id: string): void => {
    setTemplateId(id)
    templateIdRef.current = id
    setTplMenuOpen(false)
    persist({ templateId: id })
    void runEnhance()
  }

  const templateMenu = (
    <div className="tpl-menu" role="menu" aria-label="Note templates">
      {templates.map((t) => (
        <button
          key={t.id}
          type="button"
          role="menuitemradio"
          aria-checked={t.id === templateId}
          className={t.id === templateId ? 'tpl-item on' : 'tpl-item'}
          onClick={() => chooseTemplate(t.id)}
        >
          <span className="tpl-item-label">{t.label}</span>
          <span className="tpl-item-desc">{t.description}</span>
        </button>
      ))}
    </div>
  )

  // Granola-style: notes appear on their own after the meeting ends. Waits
  // for the stop to settle (capturing false, segments folded) and the model
  // to be ready; skips silently when there is nothing to write from.
  useEffect(() => {
    if (!pendingAutoGenRef.current || capturing) return
    if (enhanceStatus === 'running') return
    if (allSegments.length === 0 || !modelReady) return
    pendingAutoGenRef.current = false
    void runEnhance()
  })

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

  /* ---- ask anything ---- */

  // The chat flyout and the transcript flyout share the same spot above the
  // bar, so opening one always closes the other.
  const toggleTranscript = (): void => {
    if (transcriptOpen) {
      setTranscriptOpen(false)
    } else {
      setTranscriptOpen(true)
      setChatOpen(false)
    }
  }

  const openChat = (): void => {
    setChatOpen(true)
    setTranscriptOpen(false)
  }

  const showAskHint = (): void => {
    setAskHint(true)
    if (askHintTimerRef.current !== null) clearTimeout(askHintTimerRef.current)
    askHintTimerRef.current = setTimeout(() => {
      askHintTimerRef.current = null
      setAskHint(false)
    }, 4000)
  }

  const submitAsk = async (preset?: string): Promise<void> => {
    if (askPending !== null) return
    const question = (preset ?? askText).trim()
    if (!question) return
    // Freshest rough notes, same as runEnhance.
    if (editor && docViewRef.current === 'notes') {
      roughMarkdownRef.current = docToMarkdown(editor.getJSON())
    }
    // Nothing to ground an answer in yet — hint instead of a doomed model call.
    if (
      allSegments.length === 0 &&
      enhancedMarkdown === null &&
      roughMarkdownRef.current.trim().length === 0
    ) {
      showAskHint()
      return
    }
    refreshNotesMeta()
    setAskError(null)
    setAskStreamed('')
    setAskPending(question)
    if (preset === undefined) setAskText('')
    openChat()

    const result = await window.notes.ask({
      title: titleValueRef.current.trim() || 'New meeting',
      rawNotesMarkdown: roughMarkdownRef.current,
      enhancedMarkdown,
      segments: allSegments,
      history: chatThreadRef.current.map((c) => ({ question: c.question, answer: c.answer })),
      question
    })
    if (result.error !== undefined || result.answer === undefined) {
      setAskError(result.error ?? 'The model returned no answer.')
      setAskPending(null)
      setAskStreamed('')
      // Put the question back so a retry is one keypress away.
      setAskText((current) => (current.trim().length > 0 ? current : question))
      return
    }
    const entry: MeetingChatEntry = {
      question,
      answer: result.answer,
      askedAt: new Date().toISOString()
    }
    const next = [...chatThreadRef.current, entry]
    chatThreadRef.current = next
    setChatThread(next)
    persist({ chat: next })
    setAskPending(null)
    setAskStreamed('')
  }

  const clearChat = (): void => {
    chatThreadRef.current = []
    setChatThread([])
    setAskError(null)
    persist({ chat: [] })
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

  // A stale folderId (folder deleted elsewhere) simply resolves to no name,
  // so the chip falls back to "Add to folder".
  const folderName =
    folderId !== null ? (folders.find((f) => f.id === folderId)?.name ?? null) : null

  const transcriptEmpty = allSegments.length === 0 && Object.values(state.partials).every((p) => !p)
  const firstSegmentTime = allSegments.length > 0 ? segmentTime(allSegments[0]!) : 0

  return (
    <div className="editor-page">
      <div className="editor-topbar drag">
        <button type="button" className="back-pill no-drag" onClick={goBack} title="Back to home">
          ‹ <HomeIcon size={13} />
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

      {autoStopped && !state.error && (
        <div className="toast" role="status">
          <span>Meeting ended — recording stopped. Hit Resume if you&rsquo;re still going.</span>
          <button type="button" onClick={() => setAutoStopped(false)}>
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
            placeholder={meeting?.kind === 'note' ? 'New note' : 'New meeting'}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              titleValueRef.current = e.target.value
              scheduleNotesSave()
            }}
          />

          <div className="chips-row">
            <span className="chip">
              <CalendarIcon size={12} /> {dateChip}
            </span>
            <span className="chip">
              {meeting?.kind === 'note' ? (
                <>
                  <PencilIcon size={12} /> Note
                </>
              ) : (
                <>
                  <UsersIcon size={12} /> Me
                </>
              )}
            </span>
            <span className="chip-folder-anchor">
              <button
                type="button"
                className="chip chip-folder"
                title={folderName !== null ? 'Move to another folder' : 'Add to folder'}
                onClick={() => setFolderPickerOpen((open) => !open)}
              >
                <FolderIcon size={12} /> {folderName ?? 'Add to folder'}
              </button>
              {folderPickerOpen && (
                <FolderPicker
                  currentFolderId={folderId}
                  onAssign={assignFolder}
                  onClose={() => setFolderPickerOpen(false)}
                />
              )}
            </span>
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
            {enhancedMarkdown !== null && !capturing && (
              <button
                type="button"
                className="chip chip-regen"
                disabled={!canEnhance}
                title={!modelReady ? 'Activate a notes model in Settings first' : 'Regenerate notes'}
                aria-label="Regenerate notes"
                onClick={() => void runEnhance()}
              >
                {enhanceStatus === 'running' ? <span className="spinner" aria-hidden="true" /> : '↻'}
              </button>
            )}
            {enhancedMarkdown !== null && !capturing && (
              <span className="chip-template-anchor tpl-anchor">
                <button
                  type="button"
                  className="chip"
                  disabled={!canEnhance}
                  title="Regenerate with a different template"
                  aria-expanded={tplMenuOpen}
                  onClick={() => setTplMenuOpen((o) => !o)}
                >
                  {templates.find((t) => t.id === templateId)?.label ?? 'Template'} ▾
                </button>
                {tplMenuOpen && templateMenu}
              </span>
            )}
            {enhancedMarkdown !== null && enhanceStatus === 'running' && (
              <span className="chip-regen-status">
                <DoodlingIndicator statusText={enhanceProgressText} />
              </span>
            )}
          </div>

          {docView === 'notes' && (
            <FormatToolbar editor={editor} onPickImage={() => imageInputRef.current?.click()} />
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = imageFilesFrom(e.target.files)
              if (files.length > 0) insertImagesRef.current(files)
              e.target.value = ''
            }}
          />
          <EditorContent editor={editor} className="doc-editor" />
        </div>
      </div>

      {transcriptOpen && (
        <div className="transcript-panel">
          <div className="tp-head">
            <span className="tp-meta">{totalEcho > 0 ? `${totalEcho} echo suppressed` : ''}</span>
            <div className="tp-actions">
              {audioParts.length > 0 && !capturing && (
                <button
                  type="button"
                  onClick={() => void runRetranscribe()}
                  disabled={retranscribing}
                  title="Rebuild the transcript from the saved recording with the current model"
                >
                  {retranscribing ? 'Re-transcribing…' : 'Re-transcribe'}
                </button>
              )}
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
          {audioParts.length > 0 && !capturing && (
            <div className="tp-audio">
              <audio
                ref={audioRef}
                controls
                // "auto", never "metadata": the metadata strategy loads 64KiB,
                // aborts, and RESUMES on play — and Electron's protocol.handle
                // corrupts resumed media loads (PIPELINE_ERROR_READ ~3.6s in).
                // One continuous load of a small local file always works.
                preload="auto"
                src={audioParts[Math.min(activePart, audioParts.length - 1)]?.url}
                onLoadedMetadata={() => {
                  const sec = pendingSeekSecRef.current
                  const el = audioRef.current
                  if (sec !== null && el) {
                    pendingSeekSecRef.current = null
                    el.currentTime = sec
                    void el.play()
                  }
                }}
                onTimeUpdate={onPlayheadMoved}
                onEnded={() => {
                  // Multi-part meetings (record → stop → record) play through.
                  if (activePart < audioParts.length - 1) {
                    pendingSeekSecRef.current = 0
                    setActivePart(activePart + 1)
                  } else {
                    setPlayingSegId(null)
                  }
                }}
              />
              {audioParts.length > 1 && (
                <span className="tp-audio-part">
                  Part {Math.min(activePart, audioParts.length - 1) + 1}/{audioParts.length}
                </span>
              )}
            </div>
          )}
          <div className="tp-body" ref={feedRef}>
            {transcriptEmpty ? (
              <div className="tp-empty">
                <p className="tp-empty-title">Transcript on…</p>
                <p className="tp-empty-sub">
                  {capturing
                    ? state.transcribing
                      ? 'Start talking'
                      : 'Warming up transcription — keep talking, your audio is being captured'
                    : 'Hit record and start talking'}
                </p>
              </div>
            ) : (
              <>
                {allSegments.map((s) => (
                  <div
                    key={s.id}
                    className={[
                      'tp-row',
                      `tp-${s.channel}`,
                      audioParts.length > 0 && !capturing ? 'tp-clickable' : '',
                      playingSegId === s.id ? 'tp-playing' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={
                      audioParts.length > 0 && !capturing ? () => seekToSegment(s) : undefined
                    }
                    title={
                      audioParts.length > 0 && !capturing ? 'Play the recording from here' : undefined
                    }
                  >
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

      {chatOpen && (
        <div className="transcript-panel chat-panel">
          <div className="tp-head">
            <span className="tp-meta">Answers come only from this meeting</span>
            <div className="tp-actions">
              {chatThread.length > 0 && askPending === null && (
                <button type="button" onClick={clearChat} title="Clear conversation">
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                title="Minimize"
                aria-label="Minimize chat"
              >
                —
              </button>
            </div>
          </div>
          <div className="tp-body chat-body" ref={chatFeedRef}>
            {chatThread.length === 0 && askPending === null && !askError ? (
              <div className="tp-empty">
                <p className="tp-empty-title">Ask anything</p>
                <p className="tp-empty-sub">
                  Answers come from this meeting&rsquo;s transcript and notes.
                </p>
              </div>
            ) : (
              <>
                {chatThread.map((entry, i) => (
                  <div key={`${entry.askedAt}-${i}`} className="chat-exchange">
                    <div className="chat-q">{entry.question}</div>
                    <div
                      className="chat-a"
                      // markdownToHtml escapes its input before adding tags.
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(entry.answer) }}
                    />
                    <div className="chat-actions">
                      <button
                        type="button"
                        title="Copy response"
                        onClick={() => {
                          void navigator.clipboard.writeText(entry.answer)
                          setChatCopied(i)
                          setTimeout(() => setChatCopied((v) => (v === i ? null : v)), 1500)
                        }}
                      >
                        {chatCopied === i ? '✓ Copied' : '⧉ Copy'}
                      </button>
                    </div>
                  </div>
                ))}
                {askPending !== null && (
                  <div className="chat-exchange">
                    <div className="chat-q">{askPending}</div>
                    {askStreamed.length > 0 ? (
                      <div
                        className="chat-a"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(askStreamed) }}
                      />
                    ) : (
                      <div className="chat-a chat-thinking">
                        <span className="spinner" aria-hidden="true" />
                        Thinking…
                      </div>
                    )}
                  </div>
                )}
                {askError && (
                  <div className="chat-error" role="alert">
                    <span>{askError}</span>
                    {!modelReady && (
                      <button type="button" onClick={onOpenSettings}>
                        Open Settings →
                      </button>
                    )}
                    <button type="button" onClick={() => setAskError(null)}>
                      Dismiss
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
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

      {!capturing && allSegments.length > 0 && enhancedMarkdown === null && (
        <div className="generate-cta-wrap tpl-anchor">
          <button
            type="button"
            className="generate-cta"
            disabled={!canEnhance}
            title={!modelReady ? 'Activate a notes model in Settings first' : 'Generate notes'}
            onClick={() => void runEnhance()}
          >
            {enhanceStatus === 'running' ? (
              <DoodlingIndicator statusText={enhanceProgressText} />
            ) : (
              <>
                <SparkleIcon size={14} /> Generate notes
              </>
            )}
          </button>
          <button
            type="button"
            className="generate-cta generate-cta-arrow"
            disabled={!canEnhance}
            title="Choose a note template"
            aria-label="Choose a note template"
            aria-expanded={tplMenuOpen}
            onClick={() => setTplMenuOpen((o) => !o)}
          >
            ▾
          </button>
          {tplMenuOpen && templateMenu}
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
                onClick={toggleTranscript}
                title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
              >
                {transcriptOpen ? '⌄' : '⌃'}
              </button>
              <button
                type="button"
                className="stop-btn"
                onClick={stopRecording}
                disabled={phase === 'finishing'}
                title={phase === 'finishing' ? 'Finishing up…' : 'Stop recording'}
                aria-label="Stop recording"
              >
                ■
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={allSegments.length > 0 ? 'record-btn resume' : 'record-btn'}
                onClick={startRecording}
                title={allSegments.length > 0 ? 'Resume recording' : 'Start recording'}
              >
                <BarsIcon animated={false} />
                {allSegments.length > 0 && <span className="rec-resume">Resume</span>}
              </button>
              <button
                type="button"
                className="chev-btn"
                onClick={toggleTranscript}
                title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
              >
                {transcriptOpen ? '⌄' : '⌃'}
              </button>
            </>
          )}
        </div>

        {inputDevices.length > 0 && (
          <label className="mic-pill" title="Microphone input">
            <MicIcon />
            <select
              className="mic-select"
              aria-label="Microphone input"
              value={
                inputDeviceUid && inputDevices.some((d) => d.uid === inputDeviceUid)
                  ? inputDeviceUid
                  : ''
              }
              onChange={(e) => changeInputDevice(e.target.value)}
              onFocus={() => void refreshInputDevices()}
            >
              <option value="">
                Default{(() => {
                  const def = inputDevices.find((d) => d.isDefault)
                  return def ? ` — ${def.name}` : ''
                })()}
              </option>
              {inputDevices.map((device) => (
                <option key={device.uid} value={device.uid}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <form
          className="ask-bar"
          onSubmit={(e) => {
            e.preventDefault()
            void submitAsk()
          }}
        >
          <input
            className="ask-input"
            type="text"
            spellCheck={false}
            placeholder="Ask anything"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onFocus={() => {
              // Surface the past conversation, but never open an empty panel.
              if (chatThread.length > 0 || askPending !== null) openChat()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (chatOpen) setChatOpen(false)
                else e.currentTarget.blur()
              }
            }}
          />
          {askPending !== null ? (
            <span className="spinner ask-spinner" aria-hidden="true" />
          ) : askText.trim().length > 0 ? (
            <button type="submit" className="ask-send" title="Ask" aria-label="Ask">
              ↑
            </button>
          ) : (
            <button
              type="button"
              className="ask-preset"
              onClick={() => void submitAsk(FOLLOW_UP_EMAIL_QUESTION)}
              title="Draft a ready-to-send follow-up email from this meeting"
            >
              <MailIcon size={12} /> Write follow up email
            </button>
          )}
        </form>
      </div>

      {askHint && (
        <div className="ask-hint" role="status">
          Record the meeting first — I answer from what was said.
        </div>
      )}
    </div>
  )
}
