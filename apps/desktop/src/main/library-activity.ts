/** Serializes relocation against complete IPC/background operations, not just file writes. */
export class LibraryActivity {
  private shuttingDown = false
  private active = 0
  private blocked: Promise<void> | null = null
  private idle: (() => void) | null = null
  get moving(): boolean {
    return this.blocked !== null
  }

  /** Reserve transfer admission synchronously through the final host quit. */
  tryBeginShutdown(): (() => void) | null {
    if (this.blocked || this.shuttingDown) return null
    this.shuttingDown = true
    return () => {
      this.shuttingDown = false
    }
  }

  assertTransferAllowed(): void {
    if (this.shuttingDown)
      throw new Error('DoodleNote is shutting down. Try again if quitting fails.')
  }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    while (this.blocked) await this.blocked
    this.active++
    try {
      return await operation()
    } finally {
      if (--this.active === 0) this.idle?.()
    }
  }

  async exclusive<T>(operation: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
    this.assertTransferAllowed()
    if (this.blocked) throw new Error('A library transfer is already running.')
    let release!: () => void
    this.blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (this.active)
        await new Promise<void>((resolve, reject) => {
          this.idle = resolve
          timer = setTimeout(
            () =>
              reject(
                new Error('Some library work is still finishing. Try again when it completes.')
              ),
            timeoutMs
          )
        })
      clearTimeout(timer)
      return await operation()
    } finally {
      clearTimeout(timer)
      this.idle = null
      this.blocked = null
      release()
    }
  }
}
export const libraryActivity = new LibraryActivity()
