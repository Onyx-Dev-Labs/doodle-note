import type { RecoveryReason, SessionState } from '../shared/dictation-session'

export interface OverlayView {
  visible: boolean
  tone: 'active' | 'busy' | 'ok' | 'warn' | 'error'
  title: string
  /** Live partial text while recording; recovery text when something was kept. */
  detail: string
  /** 0..1 microphone level; null hides the meter. */
  level: number | null
  controls: { stop: boolean; cancel: boolean; copy: boolean; dismiss: boolean }
  gen: number | null
}

export interface OverlayContext {
  /** Microphone is delivering audio (the engine reported it ready). */
  micOpen: boolean
  level: number
  /** Accessibility is off, so delivery will land in recovery. */
  insertionUnavailable: boolean
}

const NONE = { stop: false, cancel: false, copy: false, dismiss: false }

export const RECOVERY_MESSAGES: Record<RecoveryReason, string> = {
  'focus-changed': 'You moved to another field, so nothing was typed.',
  'secure-field': 'That is a secure field, so nothing was typed.',
  'no-target': 'No text field was focused, so nothing was typed.',
  'not-editable': 'That control cannot take text, so nothing was typed.',
  'accessibility-denied': 'Accessibility access is off, so nothing was typed.',
  'insertion-uncertain': 'Could not confirm the text was inserted. Check before pasting again.',
  'insertion-failed': 'Insertion failed, so nothing was typed.',
  'helper-unavailable': 'The insertion helper is unavailable, so nothing was typed.'
}

export function overlayView(state: SessionState, ctx: OverlayContext): OverlayView {
  const active = state.active
  const gen = active?.gen ?? (state.resting?.kind === 'recovery' ? state.resting.gen : null)
  switch (state.phase) {
    case 'idle':
      return { visible: false, tone: 'ok', title: '', detail: '', level: null, controls: NONE, gen }
    case 'preparing':
      return {
        visible: true,
        tone: 'busy',
        title: active?.stopRequested ? 'Finishing…' : 'Starting microphone…',
        detail: '',
        level: null,
        controls: { ...NONE, cancel: true },
        gen
      }
    case 'recording': {
      const warming = !active?.asrReady
      return {
        visible: true,
        tone: 'active',
        // The microphone can be open while the speech model is still loading:
        // audio is buffered, nothing is lost, and the label says which it is.
        title: warming ? 'Listening · speech model warming up' : 'Listening',
        detail:
          active?.partial ||
          (ctx.insertionUnavailable
            ? 'Accessibility is off. Your text will be kept for copying.'
            : ''),
        level: ctx.micOpen ? ctx.level : null,
        controls: { ...NONE, stop: true, cancel: true },
        gen
      }
    }
    case 'finalizing':
      return {
        visible: true,
        tone: 'busy',
        title: 'Transcribing…',
        detail: active?.partial ?? '',
        level: null,
        controls: { ...NONE, cancel: true },
        gen
      }
    case 'cleaning':
      return {
        visible: true,
        tone: 'busy',
        title: active?.cleanupMode === 'byok' ? 'Cleaning up (your provider)…' : 'Cleaning up…',
        detail: active?.rawText ?? '',
        level: null,
        controls: { ...NONE, cancel: true },
        gen
      }
    case 'delivering':
      return {
        visible: true,
        tone: 'busy',
        title: active?.cleanupNote ? `Inserting · ${active.cleanupNote}` : 'Inserting…',
        detail: '',
        level: null,
        controls: NONE,
        gen
      }
    case 'recovery': {
      const resting = state.resting
      if (resting?.kind !== 'recovery') {
        return {
          visible: false,
          tone: 'ok',
          title: '',
          detail: '',
          level: null,
          controls: NONE,
          gen
        }
      }
      return {
        visible: true,
        tone: 'warn',
        title: RECOVERY_MESSAGES[resting.reason],
        detail: resting.text,
        level: null,
        controls: { ...NONE, copy: true, dismiss: true },
        gen
      }
    }
    case 'notice': {
      const resting = state.resting
      if (resting?.kind !== 'notice') {
        return {
          visible: false,
          tone: 'ok',
          title: '',
          detail: '',
          level: null,
          controls: NONE,
          gen
        }
      }
      return {
        visible: true,
        tone: resting.level === 'error' ? 'error' : resting.level === 'success' ? 'ok' : 'warn',
        title: resting.message,
        detail: '',
        level: null,
        controls: { ...NONE, dismiss: resting.level !== 'success' },
        gen
      }
    }
  }
}
