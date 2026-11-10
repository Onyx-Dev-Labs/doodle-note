import { FEATURE_NAME } from '../shared/dictation-brand'
import { isMessageShown, type PillEdge, type Size } from '../shared/dictation-pill'
import type { DiffSegment } from '../shared/dictation-transforms'
import type { RecoveryReason, SessionState } from '../shared/dictation-session'
import type { ClipboardOffer } from '../shared/dictation-helper-protocol'

/** rest: the small idle pill. session: the live pill. message: a notice or kept text. */
export type OverlayMode = 'rest' | 'session' | 'message'

export interface OverlayView {
  visible: boolean
  /**
   * Windows (round 24): the clipboard offer the card shows; its buttons name it, so a click acts only on the card
   * the user saw (absent on every other view).
   */
  offerRecord?: string
  /** Windows (round 28): the offer's Restore is outstanding: its button reads "Restoring…" and cannot be clicked. */
  restoring?: boolean
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
    /**
     * Windows: the clipboard offer card's own buttons (absent: hidden). They have their own actions, never the
     * shared dismiss: Restore, Dismiss (asks first), then Delete saved copy / Keep it.
     */
    offerRestore?: boolean
    offerDismiss?: boolean
    offerDelete?: boolean
    offerKeep?: boolean
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
    'An app stopped responding, so the dictation helper is restarting. Try again in a moment. Your text is kept for copying.',
  'helper-stopped':
    'An app stopped responding, so the dictation helper stopped. It has restarted too often to restart on its own; it starts again the next time it is needed. Your text is kept for copying.',
  'line-break-unsupported':
    "Pasting didn't work here, and DoodleNote won't type line breaks into this box, so nothing was typed. Use Copy text, then paste it yourself.",
  'keys-held':
    'Keys were still held down, so nothing was pasted or typed. Your text is kept for copying.',
  'clipboard-changed':
    'The clipboard changed just before pasting, so nothing was pasted. Your text is kept for copying.'
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
  /** Round 24: a card grows to fit its text (estimated), up to this; the page bounds every block too. */
  messageMax: 300,
  /** Windows: the clipboard offer card (a longer explanation and two buttons). */
  offer: { width: 460, height: 236 },
  diff: { width: 480, height: 300 }
} as const

/** The card's fixed parts in px: the root's padding, the card's border and padding, and the buttons' row. */
const CARD_FIXED = 14 + 3.2 + 20 + 22

/** About how many lines a text takes at `perLine` characters a line (counted in code points). */
function textLines(text: string, perLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil(Array.from(part).length / perLine)), 0)
}

/** Window size the page needs for a view; the overlay docks a window of this size. */
export function overlaySize(view: OverlayView, platform: string = process.platform): Size {
  if (view.mode === 'message' && view.diff) {
    // Room for the words, about 55 to a line, up to a fixed height.
    const chars = view.diff.reduce((total, part) => total + part.text.length, 0)
    const lines = Math.ceil(chars / 55)
    return {
      width: WINDOW.diff.width,
      height: Math.max(WINDOW.message.height, Math.min(WINDOW.diff.height, 110 + lines * 19))
    }
  }
  // Round 25 (macOS parity): the growth below is Windows-only (the long clipboard warnings that needed it exist only
  // there); every other platform keeps the sizes it had before round 24, exactly.
  if (view.mode === 'message' && platform !== 'win32') {
    if (view.controls.offerRestore || view.controls.offerDelete) return { ...WINDOW.offer }
    return view.warning
      ? { width: WINDOW.message.width, height: WINDOW.message.height + WINDOW.warningLine }
      : { ...WINDOW.message }
  }
  if (view.mode === 'message') {
    // Round 24: room for the title, the warning and at least ONE line of the text (an offer card: its whole
    // explanation, up to the page's three lines), and always the buttons (Astra rendered a too-large warning that
    // pushed Copy text and Dismiss out of a fixed 158 px window). An estimate of the lines (conservative characters
    // per line for the card's width), never less than the old fixed sizes, at most messageMax; the page bounds
    // every block too, so the buttons stay in view whatever the estimate.
    const offer = !!(view.controls.offerRestore || view.controls.offerDelete || view.offerRecord)
    const per = offer
      ? { title: 50, warning: 60, detail: 64 }
      : { title: 40, warning: 48, detail: 50 }
    const title = Math.min(6, textLines(view.title, per.title))
    const warning = Math.min(8, textLines(view.warning ?? '', per.warning))
    const detail = offer ? Math.min(3, textLines(view.detail, per.detail)) : view.detail ? 1 : 0
    const needed =
      CARD_FIXED +
      title * 18.2 +
      (warning ? 6 + warning * 16.2 : 0) +
      (detail ? 6 + detail * 16.2 : 0) +
      6
    const floor = offer
      ? WINDOW.offer.height
      : view.warning
        ? WINDOW.message.height + WINDOW.warningLine
        : WINDOW.message.height
    return {
      width: offer ? WINDOW.offer.width : WINDOW.message.width,
      height: Math.max(floor, Math.min(WINDOW.messageMax, Math.ceil(needed)))
    }
  }
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
  /** The clipboard could not be saved, so it was not used (nothing pasted; left as it was). */
  | 'not-saved'

/** What the overlay says about each clipboard problem. Accurate to what the helper reported. */
export const CLIPBOARD_PROBLEM_MESSAGES: Record<ClipboardProblem, string> = {
  skipped: 'Part of your clipboard was too large or could not be kept, so it was not put back.',
  partial: 'Part of your clipboard could not be put back.',
  unrestored: 'Your clipboard could not be put back. It now holds the dictated text.',
  'unrestored-foreign':
    'Your earlier clipboard could not be put back. It now holds what another app copied since.',
  'unrestored-unknown':
    'Your clipboard could not be put back, and DoodleNote could not tell what it holds now.',
  'not-saved':
    'DoodleNote could not save your clipboard, so it did not paste with it. Your clipboard was left as it was.'
}

/**
 * Rounds 23-24: why the clipboard was not used, said to the user (the reason the helper gave). A Map, so no
 * reason can reach the object prototype ("constructor"). Every reason the helper sends has its own sentence.
 */
export const CLIPBOARD_NOT_SAVED_MESSAGES: ReadonlyMap<string, string> = new Map([
  [
    'too-large',
    'Your clipboard holds something too large to save (such as a large screenshot), so DoodleNote did not paste with it and left your clipboard as it was.'
  ],
  [
    'unrendered',
    "The app you copied from did not provide your clipboard's content, so DoodleNote did not paste with it. Your clipboard was left as it was."
  ],
  [
    'nothing-savable',
    'Nothing on your clipboard could be saved, so DoodleNote did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'owner-unresponsive',
    'The app that owns your clipboard is not responding, so DoodleNote did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'zero-sequence',
    'Windows could not say whether your clipboard changed, so DoodleNote did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'no-record',
    'DoodleNote could not write down a safe copy of your clipboard first, so it did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'clipboard-changed',
    'Your clipboard changed while DoodleNote was saving it, so it did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'clipboard-busy',
    'Another app was using your clipboard when DoodleNote went to paste, so it did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'empty-failed',
    'Windows did not let DoodleNote clear your clipboard to paste, so it did not paste with it. Your clipboard was left as it was.'
  ],
  [
    'deadline',
    'There was no time left to paste safely, so DoodleNote did not paste with your clipboard. Your clipboard was left as it was.'
  ],
  [
    'no-window',
    "DoodleNote's clipboard window could not be created, so it did not paste with your clipboard. Your clipboard was left as it was."
  ],
  [
    'unreadable',
    'DoodleNote could not read your clipboard, so it did not paste with it. Your clipboard was left as it was.'
  ]
])

/** Round 24 (Opus): only when the text was NOT inserted (no double paste after a typing fallback that worked). */
const TOO_LARGE_HINT =
  ' Copy something smaller first, or copy the dictated text from DoodleNote and paste it yourself.'

const GRAPHEMES =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** A text's user-perceived characters (grapheme clusters; code points where Intl.Segmenter is absent). */
export function graphemes(text: string): string[] {
  return GRAPHEMES ? Array.from(GRAPHEMES.segment(text), (s) => s.segment) : Array.from(text)
}

/** A string cut to `max` characters, never inside a grapheme cluster (round 25), with an ellipsis. */
function clip(text: string, max: number): string {
  const parts = graphemes(text)
  return parts.length > max ? `${parts.slice(0, max).join('')}…` : text
}

/**
 * At most three names on a card or notice, then "+N more" (the window has a fixed size). `total` is the count the
 * helper reported when the list itself was shortened; by default the list's own length.
 */
export function listMissing(missing: string[], total = missing.length): string {
  const shown = missing.slice(0, 3).map((n) => clip(n, 60))
  const more = Math.max(total, missing.length) - shown.length
  return more > 0 ? `${shown.join('; ')} +${more} more` : shown.join('; ')
}

/**
 * The sentence for a clipboard problem. When the helper named what a put-back did not include, the
 * sentence names it ("Your clipboard was put back except: FileContents (not provided by the app that copied it).").
 */
export function clipboardProblemMessage(
  problem: ClipboardProblem,
  missing?: string[],
  reason?: string,
  /** The dictated text went in (by typing): no advice to paste it again. */
  delivered = false
): string {
  if ((problem === 'skipped' || problem === 'partial') && missing && missing.length > 0)
    return `Your clipboard was put back except: ${listMissing(missing)}.`
  const why =
    problem === 'not-saved' && reason ? CLIPBOARD_NOT_SAVED_MESSAGES.get(reason) : undefined
  if (why) return reason === 'too-large' && !delivered ? why + TOO_LARGE_HINT : why
  return CLIPBOARD_PROBLEM_MESSAGES[problem]
}

/** The clipboard problem a helper restore result describes, or null when there is none. */
export function clipboardProblem(
  result: string | undefined,
  holds?: string,
  notice?: string
): ClipboardProblem | null {
  if (result === 'skipped' || result === 'partial') return result
  if (result === 'restored-partially') return 'partial'
  if (notice === 'not-saved' && (result === undefined || result === 'untouched')) return 'not-saved'
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
  | {
      kind: 'clipboard'
      problem: ClipboardProblem
      missing?: string[]
      reason?: string
      /** The dictated text went in (by typing), so the notice gives no advice to paste it. */
      delivered?: boolean
    }
  /** Windows: a kept clipboard the helper could not prove its own; `changed`: what a restore would overwrite now. */
  | {
      kind: 'clipboard-offer'
      offer: ClipboardOffer
      changed?: { formats: number; bytes: number | null }
      /** Dismiss was clicked once: the card asks before the saved copy is deleted. */
      confirmDelete?: boolean
      /** The helper could not delete the saved copy: the card stays, with a line saying so. */
      deleteFailed?: boolean
      /** Round 28: its Restore is outstanding (Restore shows "Restoring…", disabled; Dismiss stays). */
      pending?: boolean
    }

/** "2 formats, 1.2 KB": an offer describes formats and size only, never content. */
export function describeClipboardSize(formats: number, bytes: number | null): string {
  const what = formats === 1 ? '1 format' : `${formats} formats`
  if (bytes === null || bytes < 0) return what
  const size =
    bytes < 1024
      ? `${bytes} bytes`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${what}, ${size}`
}

export const CLIPBOARD_OFFER_COPY = {
  title:
    'DoodleNote may have changed your clipboard while dictating. Put back what you had copied before?',
  changedTitle: 'Your clipboard has changed since DoodleNote offered this.',
  detail: (saved: string): string =>
    `Restore puts back what you had copied (${saved}) in place of what is on your clipboard now. Dismiss deletes that copy and leaves your clipboard as it is. Content a password manager marked private is never saved or offered.`,
  changedDetail: (saved: string, now: string): string =>
    `Restore now replaces what is on your clipboard (${now}) with what you had copied before (${saved}). Dismiss deletes the saved copy and leaves your clipboard as it is.`,
  confirmTitle: 'Delete the saved clipboard?',
  confirmDetail: (saved: string): string =>
    `Delete saved copy removes what you had copied before the dictation (${saved}) for good; your clipboard stays as it is. Keep it brings the offer back.`,
  deleteFailed: 'The saved copy could not be deleted. Try again.',
  // Round 23: at most three names (+N more) so the buttons stay in view; truthful when nothing goes back. Round 34
  // (Opus): a helper that ended before it emptied anything can leave an incomplete record while the user's clipboard is
  // still whole (when it changed since, so that the unchanged-since-capture proof could not delete it): say so.
  incomplete: (missing: string[], formats = 1, total = missing.length): string =>
    formats > 0
      ? `Part of this clipboard could not be saved${missing.length > 0 ? `: ${listMissing(missing, total)}` : ''}. Restore puts back the rest. If you have copied nothing since, your clipboard may still hold all of it: Dismiss keeps it as it is.`
      : `None of this clipboard could be saved${missing.length > 0 ? ` (${listMissing(missing, total)})` : ''}. There is nothing to put back; Dismiss deletes the saved record.`,
  nothingTitle: 'DoodleNote kept a record of your clipboard, but nothing of it can be put back.',
  nothingDetail: 'Dismiss deletes that record. Your clipboard stays as it is.'
} as const

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
        title: clipboardProblemMessage(panel.problem, panel.missing, panel.reason, panel.delivered),
        controls: { ...NONE, dismiss: true },
        diff: null
      }
    case 'clipboard-offer': {
      const saved = describeClipboardSize(panel.offer.formats, panel.offer.bytes)
      // Round 24 (Opus): the buttons name the record this card shows (a click acts on no other).
      const record = {
        offerRecord: panel.offer.record,
        ...(panel.pending ? { restoring: true } : {})
      }
      // Round 24 (Opus, the one rule at Restore): an incomplete offer with no user content cannot put anything back.
      const nothing = panel.offer.incomplete && panel.offer.content === 0
      if (panel.confirmDelete)
        return {
          ...common,
          ...record,
          tone: 'warn',
          title: CLIPBOARD_OFFER_COPY.confirmTitle,
          detail: CLIPBOARD_OFFER_COPY.confirmDetail(saved),
          warning: panel.deleteFailed ? CLIPBOARD_OFFER_COPY.deleteFailed : null,
          controls: { ...NONE, offerDelete: true, offerKeep: true },
          diff: null
        }
      if (nothing)
        return {
          ...common,
          ...record,
          tone: 'warn',
          title: CLIPBOARD_OFFER_COPY.nothingTitle,
          detail: CLIPBOARD_OFFER_COPY.nothingDetail,
          warning: CLIPBOARD_OFFER_COPY.incomplete(
            panel.offer.missing,
            0,
            panel.offer.missingTotal
          ),
          controls: { ...NONE, offerDismiss: true },
          diff: null
        }
      return {
        ...common,
        ...record,
        tone: 'warn',
        title: panel.changed ? CLIPBOARD_OFFER_COPY.changedTitle : CLIPBOARD_OFFER_COPY.title,
        detail: panel.changed
          ? CLIPBOARD_OFFER_COPY.changedDetail(
              saved,
              describeClipboardSize(panel.changed.formats, panel.changed.bytes)
            )
          : CLIPBOARD_OFFER_COPY.detail(saved),
        // Round 22: an incomplete offer says what a Restore cannot put back, before the user chooses.
        warning: panel.offer.incomplete
          ? CLIPBOARD_OFFER_COPY.incomplete(
              panel.offer.missing,
              panel.offer.formats,
              panel.offer.missingTotal
            )
          : null,
        controls: { ...NONE, offerRestore: true, offerDismiss: true },
        diff: null
      }
    }
  }
}
