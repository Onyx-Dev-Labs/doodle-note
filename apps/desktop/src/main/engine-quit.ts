/** Host seam: no Electron or native addon imports are needed to test ordering. */
export function createBeforeQuitHandler(host: {
  blocked(): boolean
  cleanup(): void | Promise<void>
  isUpdate(): boolean
  quit(): void
  hardExit(): void
  failed(error: unknown): void
}): (event: { preventDefault(): void }) => void {
  let cleanup: Promise<void> | undefined
  let complete = false
  return (event) => {
    if (complete) return // the resumed updater quit must flow through Electron
    event.preventDefault()
    if (cleanup || host.blocked()) return
    cleanup = Promise.resolve().then(() => host.cleanup())
    void cleanup.then(
      () => {
        complete = true
        if (host.isUpdate()) host.quit()
        else host.hardExit()
      },
      (error: unknown) => {
        // Keep the host alive on an unobserved exit; never report containment.
        host.failed(error)
      }
    )
  }
}
