import type { UpdateState } from '../shared/update-api'

interface CheckResult<T> {
  isUpdateAvailable?: boolean
  updateInfo: { version: string }
  cancellationToken?: T
}

export interface UpdateTransport<T extends { cancel(): void }> {
  checkForUpdates(): Promise<CheckResult<T> | null>
  downloadUpdate(token?: T): Promise<string[]>
}

/** Bounds checks and download inactivity; stale completions cannot reset newer UI state. */
export class UpdateCoordinator<T extends { cancel(): void }> {
  state: UpdateState
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private download: Promise<void> | null = null
  private cancelDownload: (() => void) | null = null
  private transferred = 0

  constructor(
    private readonly updater: UpdateTransport<T>,
    currentVersion: string,
    supported: boolean,
    private readonly changed: (state: UpdateState) => void,
    private readonly timeoutMs = 90_000
  ) {
    this.state = { currentVersion, supported, status: 'idle' }
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.changed(this.state)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async check(): Promise<UpdateState> {
    if (
      !this.state.supported ||
      this.state.status === 'checking' ||
      this.download ||
      this.state.status === 'downloaded'
    )
      return this.state
    const generation = ++this.generation
    this.set({ status: 'checking', error: undefined, percent: undefined, latestVersion: undefined })
    try {
      const result = await Promise.race([
        this.updater.checkForUpdates(),
        new Promise<never>((_, reject) => {
          this.timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs)
        })
      ])
      if (generation !== this.generation) return this.state
      this.clearTimer()
      if (!result?.isUpdateAvailable) {
        this.set({ status: 'up-to-date' })
        return this.state
      }
      this.transferred = 0
      this.cancelDownload = () => result.cancellationToken?.cancel()
      this.set({ status: 'downloading', latestVersion: result.updateInfo.version, percent: 0 })
      this.armDownloadTimeout()
      this.download = this.updater
        .downloadUpdate(result.cancellationToken)
        .then(() => {
          if (generation !== this.generation) return
          this.clearTimer()
          this.set({ status: 'downloaded', percent: 100, error: undefined })
        })
        .catch(() => {
          if (generation !== this.generation) return
          this.clearTimer()
          this.set({ status: 'error', error: 'Could not download the update. Please try again.' })
        })
        .finally(() => {
          this.download = null
          this.cancelDownload = null
        })
    } catch {
      if (generation !== this.generation) return this.state
      this.clearTimer()
      this.set({
        status: 'error',
        error: 'Could not check for updates. Check your connection and try again.'
      })
    }
    return this.state
  }

  private armDownloadTimeout(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.cancel('error', 'The update download stopped responding. Please try again.')
    }, this.timeoutMs)
  }

  progress(progress: { percent: number; transferred: number }): void {
    if (this.state.status !== 'downloading') return
    if (progress.transferred > this.transferred) {
      this.transferred = progress.transferred
      this.armDownloadTimeout()
    }
    this.set({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))) })
  }

  cancel(status: 'cancelled' | 'error' = 'cancelled', error?: string): void {
    if (this.state.status !== 'downloading') return
    this.generation++
    this.clearTimer()
    this.cancelDownload?.()
    this.set({ status, error, percent: undefined })
  }
}
