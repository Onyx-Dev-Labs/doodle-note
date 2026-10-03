import { createServer } from 'node:http'
import { hostname } from 'node:os'

export type DeviceLinkResult =
  | { kind: 'linked'; token: string; email: string; workspace: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

/** Owns exactly one callback listener and timer; completion never rejects. */
export class DeviceLinkAttempt {
  readonly result: Promise<DeviceLinkResult>
  private resolve!: (result: DeviceLinkResult) => void
  private settled = false
  private readonly server = createServer((req, res) => {
    if (this.settled) {
      res.writeHead(410).end()
      return
    }
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1')
    } catch {
      res.writeHead(400).end('Invalid callback. Return to DoodleNote and try again.')
      this.finish({
        kind: 'error',
        message: 'The browser returned an invalid callback — try again'
      })
      return
    }
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const token = url.searchParams.get('token') ?? ''
    if (!token.startsWith('dnsy_')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Connection failed. Return to DoodleNote and try connecting again.')
      this.finish({ kind: 'error', message: 'The browser did not return a valid token' })
      return
    }
    res.writeHead(302, { Location: `${this.baseUrl}/app` }).end()
    this.finish({
      kind: 'linked',
      token,
      email: url.searchParams.get('email') ?? '',
      workspace: url.searchParams.get('workspace') ?? ''
    })
  })
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly baseUrl: string,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly timeoutMs = 5 * 60_000
  ) {
    this.result = new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  start(): void {
    if (this.settled || this.timer) return
    this.timer = setTimeout(() => {
      this.finish({ kind: 'error', message: 'Sign-in timed out — try again' })
    }, this.timeoutMs)
    this.timer.unref?.()
    this.server.on('error', () => {
      this.finish({ kind: 'error', message: 'Could not start the connection — try again' })
    })
    this.server.listen(0, '127.0.0.1', () => {
      if (this.settled) {
        this.server.close()
        return
      }
      const address = this.server.address()
      if (!address || typeof address === 'string') return
      const query = new URLSearchParams({
        port: String(address.port),
        name: hostname().replace(/\.local$/, '') || 'Computer'
      })
      // Catch synchronous throws as well as Electron's rejected launch promise.
      void Promise.resolve()
        .then(() => {
          if (!this.settled) return this.openBrowser(`${this.baseUrl}/link-device?${query}`)
          return undefined
        })
        .catch(() => {
          this.finish({ kind: 'error', message: 'Could not open your browser — try again' })
        })
    })
  }

  cancel(): void {
    this.finish({ kind: 'cancelled' })
  }

  private finish(result: DeviceLinkResult): void {
    if (this.settled) return
    this.settled = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.server.close()
    this.server.closeAllConnections()
    this.resolve(result)
  }
}
