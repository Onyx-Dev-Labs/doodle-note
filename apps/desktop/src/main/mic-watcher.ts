import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  initialMicState,
  markPrompted,
  meetingAppLabel,
  MIC_DEBOUNCE_MS,
  onMicEvent,
  setSuppressed,
  shouldPrompt,
  type MicPromptState
} from './mic-watcher-logic'

/** Crashed child restarts after this (engine updates, transient failures). */
const RESTART_DELAY_MS = 5_000

interface MicWatcherConfig {
  enabled: boolean
}

/**
 * Ad-hoc meeting detection: runs the engine's `micmon` command (CoreAudio
 * "device is running somewhere" listener) and prompts when some other app
 * holds the microphone open past the debounce — a Zoom/Teams/Meet call that
 * never made it onto the calendar. Decision logic is pure and tested
 * (mic-watcher-logic.ts); this class owns the child process and timers.
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

  constructor(
    private readonly enginePath: string,
    userDataDir: string,
    private readonly onMeetingDetected: (appLabel: string | null) => void
  ) {
    this.configPath = join(userDataDir, 'mic-watch.json')
    this.config = this.readConfig()
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  get monitorAlive(): boolean {
    return this.child !== null
  }

  start(): void {
    if (this.config.enabled) this.spawnChild()
  }

  stop(): void {
    this.stopping = true
    this.killChild()
  }

  setEnabled(enabled: boolean): void {
    if (this.config.enabled === enabled) return
    this.config.enabled = enabled
    this.writeConfig()
    if (enabled) {
      this.spawnChild()
    } else {
      this.killChild()
      this.state = initialMicState()
    }
  }

  /** True while DoodleNote's own capture holds the mic — don't self-prompt. */
  setSuppressed(suppressed: boolean): void {
    this.state = setSuppressed(this.state, suppressed)
    if (suppressed) this.clearDebounce()
  }

  /* ---- child process ---- */

  private spawnChild(): void {
    if (this.child || this.stopping) return
    let child: ChildProcessWithoutNullStreams
    try {
      // stdin stays open as the parent-death watchdog handle.
      child = spawn(this.enginePath, ['micmon'], { stdio: ['pipe', 'pipe', 'pipe'] })
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
          }
          if (event.event === 'micmon' && typeof event.running === 'boolean') {
            // Only capture by an actual meeting app counts as "busy" —
            // dictation tools like FluidVoice must never prompt.
            const bundles = Array.isArray(event.bundles) ? event.bundles.map(String) : []
            const label = event.running ? meetingAppLabel(bundles) : null
            this.currentAppLabel = label
            this.handleMicEvent(event.running && label !== null)
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
      if (!this.stopping && this.config.enabled) {
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
    if (running && this.state.busySinceMs !== null) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null
        const now = Date.now()
        if (shouldPrompt(this.state, now)) {
          this.state = markPrompted(this.state, now)
          this.onMeetingDetected(this.currentAppLabel)
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

  /* ---- config ---- */

  private readConfig(): MicWatcherConfig {
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<MicWatcherConfig>
      return { enabled: raw.enabled !== false } // default ON
    } catch {
      return { enabled: true }
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
