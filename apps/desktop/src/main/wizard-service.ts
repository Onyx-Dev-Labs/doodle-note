import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ipcMain, systemPreferences } from 'electron'
import {
  WIZARD_PERMISSIONS_CHANNEL,
  WIZARD_PREFLIGHT_CHANNEL,
  WIZARD_PREFLIGHT_EVENT_CHANNEL,
  type WizardPermissions,
  type WizardPreflightEvent,
  type WizardPreflightResult
} from '../shared/wizard-api'

/**
 * The wizard's window into engine preflight. The launch-time preflight run
 * (index.ts) is fire-and-forget with its output discarded; the wizard needs
 * the same work with the progress VISIBLE, so it spawns its own run with a
 * piped stdout and forwards the NDJSON events. Model loads are cached, so a
 * second preflight after the silent one costs seconds, not a re-download.
 */
export class WizardService {
  constructor(
    private readonly enginePath: string,
    private readonly broadcast: (channel: string, payload: unknown) => void
  ) {}

  registerIpc(): void {
    ipcMain.handle(WIZARD_PREFLIGHT_CHANNEL, () => this.runPreflight())
    ipcMain.handle(WIZARD_PERMISSIONS_CHANNEL, (): WizardPermissions => {
      if (process.platform !== 'darwin') {
        // Windows: mic permission is requested by the renderer capture path.
        return { microphone: 'unknown', screen: 'unknown' }
      }
      const mic = systemPreferences.getMediaAccessStatus('microphone')
      const screen = systemPreferences.getMediaAccessStatus('screen')
      const map = (s: string): WizardPermissions['microphone'] =>
        s === 'granted' || s === 'denied' || s === 'not-determined' ? s : 'unknown'
      return { microphone: map(mic), screen: map(screen) }
    })
  }

  private emit(event: WizardPreflightEvent): void {
    this.broadcast(WIZARD_PREFLIGHT_EVENT_CHANNEL, event)
  }

  private runPreflight(): Promise<WizardPreflightResult> {
    return new Promise((resolve) => {
      if (!existsSync(this.enginePath)) {
        // Windows: no Swift engine; model download happens on first record.
        this.emit({ stage: 'ready' })
        resolve({ ok: true, micGranted: false, screenGranted: false })
        return
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(this.enginePath, ['preflight'], { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (err) {
        const message = `could not start the engine: ${String(err)}`
        this.emit({ stage: 'error', message })
        resolve({ ok: false, micGranted: false, screenGranted: false, error: message })
        return
      }

      let mic = false
      let screen = false
      let settled = false
      const finish = (ok: boolean, error?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve({ ok, micGranted: mic, screenGranted: screen, ...(error ? { error } : {}) })
      }
      // Permission dialogs can sit unanswered; the model download can be
      // slow. Generous, but never infinite.
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        finish(false, 'setup timed out')
      }, 15 * 60_000)

      let buffer = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          if (line.length === 0) continue
          let ev: { event?: string; stage?: string; granted?: boolean; progress?: number; message?: string }
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.event === 'status' && ev.stage === 'preflight_mic') {
            mic = ev.granted === true
            this.emit({ stage: 'mic', granted: mic })
          } else if (ev.event === 'status' && ev.stage === 'preflight_screen') {
            screen = ev.granted === true
            this.emit({ stage: 'screen', granted: screen })
          } else if (ev.event === 'status' && ev.stage === 'preflight_models') {
            this.emit({ stage: 'models' })
          } else if (ev.event === 'download' && typeof ev.progress === 'number') {
            this.emit({ stage: 'download', progress: ev.progress })
          } else if (ev.event === 'ready') {
            this.emit({ stage: 'ready' })
          } else if (ev.event === 'error') {
            this.emit({ stage: 'error', message: String(ev.message ?? 'preflight failed') })
          }
        }
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', () => {})
      child.on('error', (err) => finish(false, err.message))
      child.on('close', (code) => finish(code === 0))
    })
  }
}
