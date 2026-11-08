import { FEATURE_NAME } from '../shared/dictation-brand'
import { isMessageShown, type PillEdge, type Size } from '../shared/dictation-pill'
import type { DiffSegment } from '../shared/dictation-transforms'
import type { RecoveryReason, SessionState } from '../shared/dictation-session'

/** rest: the small idle pill. session: the live pill. message: a notice or kept text. */
export type OverlayMode = 'rest' | 'session' | 'message'

export interface OverlayView {
  visible: boolean
  mode: OverlayMode
  /** The dock edge, so the page can lay the resting and live pills out along it. */
  edge: PillEdge
  /** A short heads-up under the pill: mic muted, time almost up. */
  warning: string | null
  /**
   * The status caption (`title`) may be drawn. Off in quiet mode; the title is
   * still announced to screen readers, and failures never go through here.
   */
  showStatus: boolean
  tone: 'active' | 'busy' | 'ok' | 'warn' | 'error'
  title: string
  /** Live partial text while recording; recovery text when something was kept. */
  detail: string
  /** 0..1 microphone level; null hides the meter. */
  level: number | null
  controls: {
    stop: boolean
    cancel: boolean
    copy: boolean
    dismiss: boolean
    /** Show the before and after of a transform. */
    view: boolean
    /** Put the text from before the transform back. */
    undo: boolean
  }
  /** Before and after words, shown as a diff in a message card; null otherwise. */
  diff: DiffSegment[] | null
  /** The app the text is going into, drawn on the live pill; null hides it. */
  target: OverlayTarget | null
  gen: number | null
}

export interface OverlayTarget {
  name: string
  /** A small image as a data URL; null draws a plain placeholder. */
  icon: string | null
}

export interface OverlayContext {
  /** Microphone is delivering audio (the engine reported it ready). */
  micOpen: boolean
  level: number
  /** Accessibility is off, so delivery will land in recovery. */
  insertionUnavailable: boolean
  /** Show the resting pill while nothing is running. */
  pillVisible: boolean
  edge: PillEdge
  /** Quiet mode: show the words being recognised. */
  showLiveText: boolean
  /** Quiet mode: show status captions and success confirmations. */
  showStatusMessages: boolean
  /** The app the live session will type into, when the user wants it shown. */
  target: OverlayTarget | null
  /**
   * Windows only: the user's clipboard could not be fully put back after this recovery's delivery
   * attempt; shown on the recovery card's warning line.
   */
  clipboardWarning?: string | null
}

const NONE = { stop: false, cancel: false, copy: false, dismiss: false, view: false, undo: false }

export const RECOVERY_MESSAGES: Record<RecoveryReason, string> = {
  'focus-changed': 'You moved to another field, so nothing was typed.',
  'secure-field': 'That is a secure field, so nothing was typed.',
  'no-target': 'No text field was focused, so nothing was typed.',
  'not-editable': 'That control cannot take text, so nothing was typed.',
  'accessibility-denied': 'Accessibility access is off, so nothing was typed.',
  'elevated-target':
    'That app is running as administrator, so DoodleNote cannot type into it. Your text is kept for copying.',
  'insertion-uncertain': 'Could not confirm the text was inserted. Check before pasting again.',
  'insertion-failed': 'Insertion failed, so nothing was typed.',
  'helper-unavailable': 'The insertion helper is unavailable, so nothing was typed.',
  'selection-changed':
    'The selection changed while the text was being rewritten, so nothing was replaced.',
  'text-changed': 'The text there has changed since, so it was not put back.',
  'paste-unavailable':
    'Could not paste into this app. Typing instead works only in classic Windows text boxes, not in browsers, Electron apps or other modern apps, so nothing was typed. Your text is kept for copying.',
  'target-unverifiable':
    'Could not check that this field is safe to type into, so nothing more was typed. Your text is kept for copying.',
  'typing-stopped':
    'Typing stopped part-way because a character could not be confirmed. Check the field before pasting; your text is kept for copying.',
  'typing-stopped-secure':
    'Typing stopped because the field became a password field. Check it; the rest was not typed, and your text is kept for copying.',
  'helper-busy':
    'An app is not responding, so DoodleNote could not check the field. Try again in a moment. Your text is kept for copying.'
}

/** Copy for the heads-up line under the live pill. */
export const WARNINGS = {
  limit: 'One minute left. Then it finishes.',
  muted: 'Your microphone looks muted.',
  fellBack: 'Microphone not found. Using the default.'
} as const

const WINDOW = {
  restLong: 92,
  restShort: 40,
  sessionWidth: 320,
  /** Room for the arrow and the app icon on the live pill. */
  sessionWithTargetWidth: 372,
  sessionBase: 56,
  sideWidth: 58,
  sideHeight: 224,
  sideTargetHeight: 36,
  sideCaptionWidth: 250,
  warningLine: 26,
  detailBlock: 64,
  message: { width: 380, height: 132 },
  diff: { width: 480, height: 300 }
} as const

/** Window size the page needs for a view; the overlay docks a window of this size. */
export function overlaySize(view: OverlayView): Size {
  if (view.mode === 'message' && view.diff) {
    // Room for the words, about 55 to a line, up to a fixed height.
    const chars = view.diff.reduce((total, part) => total + part.text.length, 0)
    const lines = Math.ceil(chars / 55)
    return {
      width: WINDOW.diff.width,
      height: Math.max(WINDOW.message.height, Math.min(WINDOW.diff.height, 110 + lines * 19))
    }
  }
  if (view.mode === 'message')
    // A warning line on a card (Windows: the clipboard could not be fully put back) needs room.
    return view.warning
      ? { width: WINDOW.message.width, height: WINDOW.message.height + WINDOW.warningLine }
      : { ...WINDOW.message }
  if (view.mode === 'session') {
    if (view.edge !== 'bottom') {
      const status = view.showStatus && !(view.tone === 'active' && view.title === 'Listening')
      return {
        width:
          WINDOW.sideWidth + (view.warning || view.detail || status ? WINDOW.sideCaptionWidth : 0),
        height: WINDOW.sideHeight + (view.target ? WINDOW.sideTargetHeight : 0)
      }
    }
    return {
      width: view.target ? WINDOW.sessionWithTargetWidth : WINDOW.sessionWidth,
      height:
        WINDOW.sessionBase +
        (view.warning ? WINDOW.warningLine : 0) +
        (view.detail ? WINDOW.detailBlock : 0)
    }
  }
  // The resting pill lies along the edge it docks to.
  return view.edge === 'bottom'
    ? { width: WINDOW.restLong, height: WINDOW.restShort }
    : { width: WINDOW.restShort, height: WINDOW.restLong }
}

export function overlayView(state: SessionState, ctx: OverlayContext): OverlayView {
  const active = state.active
  const gen = active?.gen ?? (state.resting?.kind === 'recovery' ? state.resting.gen : null)
  const prefs = { showLiveText: ctx.showLiveText, showStatusMessages: ctx.showStatusMessages }
  // Transcript text on the pill (partials, raw words) is the 'live-text' kind.
  const liveText = (text: string): string => (isMessageShown('live-text', prefs) ? text : '')
  const view = (
    mode: OverlayMode,
    fields: Pick<OverlayView, 'tone' | 'title' | 'detail' | 'level' | 'controls'> &
      Partial<Pick<OverlayView, 'warning'>>
  ): OverlayView => ({
    visible: true,
    mode,
    edge: ctx.edge,
    warning: null,
    showStatus: isMessageShown('status', prefs),
    diff: null,
    // Only the live pill points at the app; the resting pill and cards do not.
    target: mode === 'session' ? ctx.target : null,
    gen,
    ...fields
  })
  const hidden = (): OverlayView => ({
    ...view('rest', { tone: 'ok', title: '', detail: '', level: null, controls: NONE }),
    visible: false
  })
  switch (state.phase) {
    case 'idle':
      if (!ctx.pillVisible) return hidden()
      return view('rest', {
        tone: 'ok',
        title: `Start ${FEATURE_NAME}`,
        detail: '',
        level: null,
        controls: NONE
      })
    case 'preparing':
      return view('session', {
        tone: 'busy',
        title: active?.stopRequested ? 'Finishing…' : 'Starting microphone…',
        detail: '',
        level: null,
        controls: { ...NONE, cancel: true }
      })
    case 'recording': {
      const warming = !active?.asrReady
      return view('session', {
        tone: 'active',
        // The microphone can be open while the speech model is still loading:
        // audio is buffered, nothing is lost, and the label says which it is.
        title: warming ? 'Listening · speech model warming up' : 'Listening',
        // The accessibility hint is a failure notice: quiet mode never hides it.
        detail:
          liveText(active?.partial ?? '') ||
          (ctx.insertionUnavailable
            ? 'Accessibility is off. Your text will be kept for copying.'
            : ''),
        level: ctx.micOpen ? ctx.level : null,
        controls: { ...NONE, stop: true, cancel: true },
        warning: active?.micMuted
          ? WARNINGS.muted
          : active?.limitWarning
            ? WARNINGS.limit
            : active?.micFellBack
              ? WARNINGS.fellBack
              : null
      })
    }
    case 'finalizing':
      return view('session', {
        tone: 'busy',
        title: 'Transcribing…',
        detail: liveText(active?.partial ?? ''),
        level: null,
        controls: { ...NONE, cancel: true }
      })
    case 'cleaning':
      return view('session', {
        tone: 'busy',
        title: active?.cleanupMode === 'byok' ? 'Cleaning up (your provider)…' : 'Cleaning up…',
        detail: liveText(active?.rawText ?? ''),
        level: null,
        controls: { ...NONE, cancel: true }
      })
    case 'delivering':
      return view('session', {
        tone: 'busy',
        title: active?.cleanupNote ? `Inserting · ${active.cleanupNote}` : 'Inserting…',
        detail: '',
        level: null,
        controls: NONE
      })
    case 'recovery': {
      const resting = state.resting
      if (resting?.kind !== 'recovery') return hidden()
      return view('message', {
        tone: 'warn',
        title: RECOVERY_MESSAGES[resting.reason],
        detail: resting.text,
        level: null,
        controls: { ...NONE, copy: true, dismiss: true },
        warning: ctx.clipboardWarning ?? null
      })
    }
    case 'notice': {
      const resting = state.resting
      if (resting?.kind !== 'notice') return hidden()
      // "Inserted." and its kin only confirm success; quiet mode skips them.
      if (resting.level === 'success' && !isMessageShown('success', prefs)) {
        return ctx.pillVisible
          ? view('rest', {
              tone: 'ok',
              title: `Start ${FEATURE_NAME}`,
              detail: '',
              level: null,
              controls: NONE
            })
          : hidden()
      }
      return view('message', {
        tone: resting.level === 'error' ? 'error' : resting.level === 'success' ? 'ok' : 'warn',
        title: resting.message,
        detail: '',
        level: null,
        controls: { ...NONE, dismiss: resting.level !== 'success' }
      })
    }
  }
}

/** Windows: how the user's clipboard fared after a paste (see the helper's restore results). */
export type ClipboardProblem =
  | 'skipped'
  | 'partial'
  /** Not put back; it still holds the dictated text. */
  | 'unrestored'
  /** Not put back; another app copied something since, which it now holds. */
  | 'unrestored-foreign'
  /** Not put back; what it holds could not be told. */
  | 'unrestored-unknown'

/** What the overlay says about each clipboard problem. Accurate to what the helper reported. */
export const CLIPBOARD_PROBLEM_MESSAGES: Record<ClipboardProblem, string> = {
  skipped: 'Part of your clipboard was too large or could not be kept, so it was not put back.',
  partial: 'Part of your clipboard could not be put back.',
  unrestored: 'Your clipboard could not be put back. It now holds the dictated text.',
  'unrestored-foreign':
    'Your earlier clipboard could not be put back. It now holds what another app copied since.',
  'unrestored-unknown':
    'Your clipboard could not be put back, and DoodleNote could not tell what it holds now.'
}

/** The clipboard problem a helper restore result describes, or null when there is none. */
export function clipboardProblem(
  result: string | undefined,
  holds?: string
): ClipboardProblem | null {
  if (result === 'skipped' || result === 'partial') return result
  if (result !== 'unrestored') return null
  // Only what the helper reported: our text, another app's newer copy, or unknown.
  if (holds === 'dictated') return 'unrestored'
  if (holds === 'foreign') return 'unrestored-foreign'
  return 'unrestored-unknown'
}

/** A small panel the service shows after a transform, over the resting pill. */
export type OverlayPanel =
  | { kind: 'working'; name: string }
  | { kind: 'changed'; name: string }
  | { kind: 'diff'; name: string; segments: DiffSegment[] }
  | { kind: 'learned'; pairs: Array<{ from: string; to: string }> }
  | { kind: 'clipboard'; problem: ClipboardProblem }

/** The view for a panel; `base` supplies the edge and the quiet settings. */
export function panelView(panel: OverlayPanel, base: OverlayView): OverlayView {
  const common = {
    visible: true,
    mode: 'message' as const,
    edge: base.edge,
    warning: null,
    showStatus: base.showStatus,
    gen: null,
    level: null,
    detail: '',
    target: null
  }
  switch (panel.kind) {
    case 'working':
      return { ...common, tone: 'busy', title: `${panel.name}…`, controls: NONE, diff: null }
    case 'changed':
      return {
        ...common,
        tone: 'ok',
        title: `Changed by ${panel.name}.`,
        controls: { ...NONE, view: true, undo: true, dismiss: true },
        diff: null
      }
    case 'learned': {
      const [first] = panel.pairs
      const title =
        panel.pairs.length === 1 && first
          ? `Added to your dictionary: ${first.from} → ${first.to}`
          : `Added ${panel.pairs.length} corrections to your dictionary.`
      return { ...common, tone: 'ok', title, controls: { ...NONE, dismiss: true }, diff: null }
    }
    case 'diff':
      return {
        ...common,
        tone: 'ok',
        title: `${panel.name}: before and after`,
        controls: { ...NONE, undo: true, dismiss: true },
        diff: panel.segments
      }
    case 'clipboard':
      return {
        ...common,
        tone: 'warn',
        title: CLIPBOARD_PROBLEM_MESSAGES[panel.problem],
        controls: { ...NONE, dismiss: true },
        diff: null
      }
  }
}
