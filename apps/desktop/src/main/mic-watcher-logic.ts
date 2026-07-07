/**
 * Pure "should the mic activity prompt fire?" logic, Electron-free so it can
 * be unit-tested with node:test (see mic-watcher-logic.test.ts). MicWatcher
 * feeds it micmon events and asks when the debounce timer lands.
 */

/** Meeting-app audio must persist this long before we prompt — long enough
 *  to outlive chat dings (1-2s), short enough to land early in a ring. */
export const MIC_DEBOUNCE_MS = 4_000
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
  { pattern: 'com.brave.browser', label: 'browser' },
  // Windows: ConsentStore key names — exe paths ('#' for '\') for classic
  // apps, package family names for Store apps (new Teams = MSTeams_…).
  { pattern: 'zoom.exe', label: 'Zoom' },
  { pattern: 'msteams', label: 'Teams' },
  { pattern: 'teams.exe', label: 'Teams' },
  { pattern: 'webex', label: 'Webex' },
  { pattern: 'ciscocollab', label: 'Webex' },
  { pattern: 'slack.exe', label: 'Slack' },
  { pattern: 'discord.exe', label: 'Discord' },
  { pattern: 'skype.exe', label: 'Skype' },
  { pattern: 'chrome.exe', label: 'browser' },
  { pattern: 'msedge', label: 'browser' },
  { pattern: 'firefox.exe', label: 'browser' },
  { pattern: 'brave.exe', label: 'browser' },
  { pattern: 'arc.exe', label: 'browser' }
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

/**
 * Ring detection works on audio OUTPUT — an incoming call rings long before
 * the mic engages. Browsers are excluded here (any tab playing audio would
 * read as a meeting); only native meeting apps count, and the debounce
 * filters their short notification dings.
 */
export function meetingRingLabel(bundles: readonly string[]): string | null {
  const label = meetingAppLabel(bundles)
  return label === 'browser' ? null : label
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

/* ---- meeting-end watch (auto-stop recording, Granola-style) ---- */

/**
 * The meeting app must stay OFF the mic this long before we call the meeting
 * over — survives reconnects, device switches, and brief network blips.
 */
export const MEETING_END_DEBOUNCE_MS = 12_000

/**
 * Tracked only while DoodleNote itself is recording. Our engine is a bare
 * binary with no bundle id, so it never appears in micmon's bundle list —
 * the meeting app's presence/absence stays cleanly observable during capture.
 */
export interface MeetingEndState {
  /** A meeting app held the mic at some point during this capture. */
  meetingSeen: boolean
  /** Epoch ms when the meeting app dropped off the mic; null while present. */
  absentSinceMs: number | null
  /** Auto-stop already fired for this capture. */
  ended: boolean
}

export function initialEndState(): MeetingEndState {
  return { meetingSeen: false, absentSinceMs: null, ended: false }
}

/** Apply a micmon event observed during capture (present = meeting app on mic). */
export function onCaptureMicEvent(
  state: MeetingEndState,
  meetingPresent: boolean,
  nowMs: number
): MeetingEndState {
  if (state.ended) return state
  if (meetingPresent) {
    return { ...state, meetingSeen: true, absentSinceMs: null }
  }
  if (!state.meetingSeen) return state // plain mic-only recording — never ends
  return state.absentSinceMs === null ? { ...state, absentSinceMs: nowMs } : state
}

/** True when the absence has outlasted the debounce — stop the recording. */
export function shouldAutoStop(state: MeetingEndState, nowMs: number): boolean {
  return (
    !state.ended &&
    state.meetingSeen &&
    state.absentSinceMs !== null &&
    nowMs - state.absentSinceMs >= MEETING_END_DEBOUNCE_MS
  )
}

export function markEnded(state: MeetingEndState): MeetingEndState {
  return { ...state, ended: true, absentSinceMs: null }
}
