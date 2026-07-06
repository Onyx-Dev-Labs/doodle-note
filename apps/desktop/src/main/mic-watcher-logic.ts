/**
 * Pure "should the mic activity prompt fire?" logic, Electron-free so it can
 * be unit-tested with node:test (see mic-watcher-logic.test.ts). MicWatcher
 * feeds it micmon events and asks when the debounce timer lands.
 */

/** The mic must be held open this long before we call it a meeting. */
export const MIC_DEBOUNCE_MS = 8_000
/** After a prompt (or a dismissal), stay quiet this long. */
export const MIC_COOLDOWN_MS = 5 * 60_000

/**
 * Only mic capture by an actual meeting app counts — dictation tools
 * (FluidVoice et al.), voice memos, and everything else are ignored by
 * bundle id. Browsers are included for Meet/Teams-web. Substring match,
 * lowercase.
 */
const MEETING_BUNDLE_PATTERNS: ReadonlyArray<{ pattern: string; label: string }> = [
  { pattern: 'us.zoom', label: 'Zoom' },
  { pattern: 'com.microsoft.teams', label: 'Teams' },
  { pattern: 'cisco', label: 'Webex' }, // Cisco-Systems.Spark
  { pattern: 'com.tinyspeck.slackmacgap', label: 'Slack' },
  { pattern: 'com.hnc.discord', label: 'Discord' },
  { pattern: 'com.apple.facetime', label: 'FaceTime' },
  { pattern: 'com.skype', label: 'Skype' },
  { pattern: 'com.google.chrome', label: 'browser' },
  { pattern: 'com.apple.safari', label: 'browser' },
  { pattern: 'org.mozilla.firefox', label: 'browser' },
  { pattern: 'com.microsoft.edgemac', label: 'browser' },
  { pattern: 'company.thebrowser', label: 'browser' }, // Arc
  { pattern: 'com.brave.browser', label: 'browser' }
]

/**
 * The friendly name of the first meeting app among the capturing bundles,
 * or null when none of them is meeting-shaped. Empty bundle info (macOS
 * < 14.4 or attribution failure) is conservative: no prompt.
 */
export function meetingAppLabel(bundles: readonly string[]): string | null {
  for (const bundle of bundles) {
    const lower = bundle.toLowerCase()
    const match = MEETING_BUNDLE_PATTERNS.find((m) => lower.includes(m.pattern))
    if (match) return match.label
  }
  return null
}

export interface MicPromptState {
  /** Epoch ms when the mic went busy; null while idle. */
  busySinceMs: number | null
  /** We already prompted for this continuous busy stretch. */
  promptedThisSession: boolean
  /** Epoch ms of the last prompt, for the cooldown. */
  lastPromptMs: number
  /** Our own capture is running — everything is ignored until it isn't. */
  suppressed: boolean
}

export function initialMicState(): MicPromptState {
  return { busySinceMs: null, promptedThisSession: false, lastPromptMs: 0, suppressed: false }
}

/** Apply a micmon running=true/false transition. */
export function onMicEvent(state: MicPromptState, running: boolean, nowMs: number): MicPromptState {
  if (state.suppressed) return state
  if (running) {
    // Already tracking this busy stretch — keep its original start.
    if (state.busySinceMs !== null) return state
    return { ...state, busySinceMs: nowMs }
  }
  // Idle again: the next busy stretch may prompt anew (cooldown permitting).
  return { ...state, busySinceMs: null, promptedThisSession: false }
}

/**
 * While our own engine captures, the mic is busy because of US — ignore it,
 * and when suppression lifts, require a fresh idle→busy edge before promoting
 * any activity to a prompt (the meeting app's mic use may simply continue).
 */
export function setSuppressed(state: MicPromptState, suppressed: boolean): MicPromptState {
  if (suppressed) return { ...state, suppressed: true, busySinceMs: null }
  return { ...state, suppressed: false, busySinceMs: null, promptedThisSession: false }
}

/** True when the debounced busy stretch should fire the prompt at nowMs. */
export function shouldPrompt(state: MicPromptState, nowMs: number): boolean {
  if (state.suppressed || state.promptedThisSession) return false
  if (state.busySinceMs === null) return false
  if (nowMs - state.busySinceMs < MIC_DEBOUNCE_MS) return false
  return nowMs - state.lastPromptMs >= MIC_COOLDOWN_MS
}

/** Record that the prompt fired. */
export function markPrompted(state: MicPromptState, nowMs: number): MicPromptState {
  return { ...state, promptedThisSession: true, lastPromptMs: nowMs }
}
