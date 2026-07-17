import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WIN_MICMON_ARGS } from './win-micmon'
import {
  initialEndState,
  initialMicState,
  markEnded,
  markPrompted,
  MEETING_END_DEBOUNCE_MS,
  meetingPromptLabel,
  MIC_DEBOUNCE_MS,
  onCaptureMicEvent,
  onMicEvent,
  setSuppressed,
  shouldAutoStop,
  shouldPrompt,
  type MeetingEndState,
  type MicPromptState
} from './mic-watcher-logic'

/** Crashed child restarts after this (engine updates, transient failures). */
const RESTART_DELAY_MS = 5_000

interface MicWatcherConfig {
  /** Prompt when a meeting app grabs the mic (ad-hoc detection). */
  enabled: boolean
  /** Stop the recording when the meeting app releases the mic. */
  autoStop: boolean
}

/**
 * Ad-hoc meeting detection: watches which apps hold the microphone and
 * prompts when a meeting app keeps it open past the debounce — a
 * Zoom/Teams/Meet call that never made it onto the calendar. The signal
 * source is per-platform: macOS runs the engine's `micmon` command (CoreAudio
 * process attribution); Windows runs a PowerShell poll of the ConsentStore
 * registry (win-micmon.ts). Decision logic is pure and tested
 * (mic-watcher-logic.ts); this class owns the child process and timers.
 * macOS output activity is logged as context but never creates
 * a prompt by itself because CoreAudio cannot distinguish a ring from normal
 * playback within Zoom, Slack, Discord, or another meeting-shaped app.
 */
export class MicWatcher {
  private config: MicWatcherConfig
  private readonly configPath: string
  private state: MicPromptState = initialMicState()
  private child: ChildProcessWithoutNullStreams | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private stopping = false

  /** Friendly name of the meeting app behind the current busy stretch. */
  private currentAppLabel: string | null = null

  /**
   * Meeting app currently holding the MIC — input only, never ring/output.
   * The end watch must be seeded from this and not from currentAppLabel:
   * a Zoom that is only ringing (audio output) sets currentAppLabel, and
   * seeding meetingSeen from it while Zoom never takes the mic made every
   * recording started from a ring prompt auto-stop after exactly 12s.
   */
  private currentInputLabel: string | null = null

  /** Meeting-end watch, alive only while our own capture runs (suppressed). */
  private capturing = false
  private endState: MeetingEndState = initialEndState()
  private endTimer: NodeJS.Timeout | null = null

  private readonly logPath: string

  constructor(
    private readonly enginePath: string,
    userDataDir: string,
    private readonly onMeetingDetected: (appLabel: string | null) => void,
    /** The meeting app left the mic mid-capture — stop the recording. */
    private readonly onMeetingEnded: () => void
  ) {
    this.configPath = join(userDataDir, 'mic-watch.json')
    this.logPath = join(userDataDir, 'mic-watch.log')
    this.config = this.readConfig()
    try {
      if (statSync(this.logPath).size > 2 * 1024 * 1024) writeFileSync(this.logPath, '')
    } catch {
      // no log yet
    }
  }

  /** Detection diary — read this to diagnose missed/false prompts. */
  private diag(message: string): void {
    try {
      appendFileSync(this.logPath, `${new Date().toISOString()} ${message}\n`)
    } catch {
      // never let logging break detection
    }
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  get autoStop(): boolean {
    return this.config.autoStop
  }

  get monitorAlive(): boolean {
    return this.child !== null
  }

  /** Either feature needs the micmon child. */
  private get childWanted(): boolean {
    return this.config.enabled || this.config.autoStop
  }

  start(): void {
    if (this.childWanted) this.spawnChild()
  }

  stop(): void {
    this.stopping = true
    this.killChild()
  }

  setEnabled(enabled: boolean): void {
    if (this.config.enabled === enabled) return
    this.config.enabled = enabled
    this.writeConfig()
    this.state = initialMicState()
    this.reconcileChild()
  }

  setAutoStop(autoStop: boolean): void {
    if (this.config.autoStop === autoStop) return
    this.config.autoStop = autoStop
    this.writeConfig()
    this.resetEndWatch()
    this.reconcileChild()
  }

  private reconcileChild(): void {
    if (this.childWanted) {
      this.spawnChild()
    } else {
      this.killChild()
    }
  }

  /** True while DoodleNote's own capture holds the mic — don't self-prompt.
   *  That same window is when the meeting-end watch is armed. */
  setSuppressed(suppressed: boolean): void {
    this.state = setSuppressed(this.state, suppressed)
    if (suppressed) this.clearDebounce()
    this.capturing = suppressed
    this.resetEndWatch()
    // micmon only emits on CHANGES — if the meeting app already held the mic
    // when recording started (the normal case), seed the watch from the
    // last-known INPUT state or the end edge would never arm. Ring-only
    // evidence must not seed it (see currentInputLabel); a call that is
    // still ringing arms the watch later, when the app takes the mic.
    if (suppressed && this.currentInputLabel !== null) {
      this.diag(`end-watch seeded: ${this.currentInputLabel} already on the mic`)
      this.endState = onCaptureMicEvent(this.endState, true, Date.now())
    }
  }

  private resetEndWatch(): void {
    this.endState = initialEndState()
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
  }

  /* ---- child process ---- */

  private spawnChild(): void {
    if (this.child || this.stopping) return
    let child: ChildProcessWithoutNullStreams
    try {
      if (process.platform === 'win32') {
        // Parent-death watchdog is a PID check inside the script's poll loop.
        child = spawn('powershell.exe', WIN_MICMON_ARGS, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, DOODLE_PARENT_PID: String(process.pid) },
          windowsHide: true
        })
      } else {
        // stdin stays open as the parent-death watchdog handle.
        child = spawn(this.enginePath, ['micmon'], { stdio: ['pipe', 'pipe', 'pipe'] })
      }
    } catch (error) {
      console.error('[micwatch] spawn failed:', error)
      return
    }
    this.child = child

    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line.length === 0) continue
        try {
          const event = JSON.parse(line) as {
            event?: string
            running?: boolean
            bundles?: string[]
            outputBundles?: string[]
          }
          if (event.event === 'micmon' && typeof event.running === 'boolean') {
            // Only microphone capture by an actual meeting app counts as
            // "busy". Output remains useful diagnostic context, but an open
            // output session is not proof of a call and must never prompt.
            const bundles = Array.isArray(event.bundles) ? event.bundles.map(String) : []
            const output = Array.isArray(event.outputBundles) ? event.outputBundles.map(String) : []
            const inputLabel = meetingPromptLabel({
              inputRunning: event.running,
              inputBundles: bundles,
              outputBundles: output
            })
            this.currentAppLabel = inputLabel
            this.currentInputLabel = inputLabel
            this.diag(
              `event running=${event.running} in=[${bundles.join(',')}] out=[${output.join(',')}] ` +
                `inputLabel=${inputLabel} outputOnlyIgnored=${inputLabel === null && output.length > 0} ` +
                `suppressed=${this.state.suppressed}`
            )
            this.handleMicEvent(inputLabel !== null)
            this.handleEndWatch(inputLabel !== null)
          }
        } catch {
          // CoreML/CoreAudio noise on stdout — NDJSON hosts skip unparseable lines.
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {})
    child.on('exit', () => {
      this.child = null
      this.clearDebounce()
      if (!this.stopping && this.childWanted) {
        this.restartTimer = setTimeout(() => this.spawnChild(), RESTART_DELAY_MS)
        this.restartTimer.unref?.()
      }
    })
    child.on('error', (error) => {
      console.error('[micwatch] child error:', error.message)
    })
  }

  private killChild(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.clearDebounce()
    if (this.child) {
      // Closing stdin triggers the engine's own clean exit path.
      try {
        this.child.stdin.end()
      } catch {
        // already gone
      }
      const child = this.child
      setTimeout(() => {
        if (!child.killed) child.kill()
      }, 2_000).unref()
      this.child = null
    }
  }

  /* ---- decision plumbing ---- */

  private handleMicEvent(running: boolean): void {
    this.state = onMicEvent(this.state, running, Date.now())
    this.clearDebounce()
    // The child may be alive for auto-stop alone — prompts obey the toggle.
    if (!this.config.enabled) return
    if (running && this.state.busySinceMs !== null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        const now = Date.now()
        if (shouldPrompt(this.state, now)) {
          this.state = markPrompted(this.state, now)
          this.diag(`PROMPT fired (${this.currentAppLabel ?? 'unknown app'})`)
          this.onMeetingDetected(this.currentAppLabel)
        } else {
          this.diag(
            `debounce elapsed but no prompt: prompted=${this.state.promptedThisSession} ` +
              `cooldownRemainMs=${Math.max(0, this.state.lastPromptMs + 5 * 60_000 - now)} ` +
              `busySince=${this.state.busySinceMs}`
          )
        }
      }, MIC_DEBOUNCE_MS)
      this.debounceTimer.unref?.()
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  /** Meeting-end watch: armed while our capture runs and autoStop is on. */
  private handleEndWatch(meetingPresent: boolean): void {
    if (!this.capturing || !this.config.autoStop) return
    this.endState = onCaptureMicEvent(this.endState, meetingPresent, Date.now())
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    if (this.endState.absentSinceMs !== null && !this.endState.ended) {
      this.endTimer = setTimeout(() => {
        this.endTimer = null
        if (this.capturing && shouldAutoStop(this.endState, Date.now())) {
          this.endState = markEnded(this.endState)
          this.diag('AUTO-STOP fired: meeting app off the mic past debounce')
          this.onMeetingEnded()
        }
      }, MEETING_END_DEBOUNCE_MS)
      this.endTimer.unref?.()
    }
  }

  /* ---- config ---- */

  private readConfig(): MicWatcherConfig {
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<MicWatcherConfig>
      // Both default ON.
      return { enabled: raw.enabled !== false, autoStop: raw.autoStop !== false }
    } catch {
      return { enabled: true, autoStop: true }
    }
  }

  private writeConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (error) {
      console.error('[micwatch] could not persist config:', error)
    }
  }
}
