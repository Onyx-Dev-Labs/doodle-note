import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

/** Only these callback fields may leave the application-owned listener. */
interface CalendarAuthCode {
  code: string
  state: string
  client_info?: string
}

/** A single-use, cancellable browser callback, independent of MSAL's internal listener. */
export class CalendarAuthLoopback {
  readonly state = randomBytes(32).toString('base64url')
  private server?: Server
  private reject?: (error: Error) => void
  private rejectReady?: (error: Error) => void
  private ready?: Promise<void>
  private closed = false
  private settled = false

  listenForAuthCode(successTemplate = '', errorTemplate = ''): Promise<CalendarAuthCode> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Microsoft sign-in cancelled.'))
        return
      }
      if (this.server) {
        reject(new Error('Microsoft sign-in callback already started.'))
        return
      }
      this.reject = reject
      let markReady: () => void = () => {}
      this.ready = new Promise<void>((resolve, reject) => {
        markReady = resolve
        this.rejectReady = reject
      })
      // Cancellation/bind failure may precede the caller awaiting readiness.
      void this.ready.catch(() => {})
      this.server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        if (url.pathname !== '/' || request.method !== 'GET') {
          response.writeHead(404).end()
          return
        }
        if (!url.search) {
          response.end(successTemplate)
          return
        }
        if (
          this.settled ||
          url.searchParams.getAll('state').length !== 1 ||
          url.searchParams.get('state') !== this.state
        ) {
          response.writeHead(400).end(errorTemplate)
          return
        }
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (
          (!code && !error) ||
          (code && error) ||
          url.searchParams.getAll('code').length > 1 ||
          url.searchParams.getAll('error').length > 1 ||
          url.searchParams.getAll('client_info').length > 1
        ) {
          response.writeHead(400).end(errorTemplate)
          return
        }
        response.writeHead(302, { Location: this.getRedirectUri() }).end()
        this.settled = true
        this.reject = undefined
        if (error) reject(new Error('Microsoft sign-in was not completed. Try again.'))
        else
          resolve({
            code: code!,
            state: this.state,
            client_info: url.searchParams.get('client_info') ?? undefined
          })
      })
      this.server.once('error', () => {
        const error = new Error('Microsoft sign-in could not open its local callback. Try again.')
        this.rejectReady?.(error)
        this.reject?.(error)
        this.closeServer()
      })
      this.server.listen(0, '127.0.0.1', () => {
        // close() may race the asynchronous bind. Never leave a late listener alive.
        if (this.closed) {
          this.closeServer()
          return
        }
        this.rejectReady = undefined
        markReady()
      })
    })
  }

  async waitForRedirectUri(): Promise<string> {
    if (!this.ready) throw new Error('Microsoft sign-in callback is not started.')
    await this.ready
    return this.getRedirectUri()
  }

  getRedirectUri(): string {
    if (this.closed) throw new Error('Microsoft sign-in cancelled.')
    const address = this.server?.address()
    if (!address || typeof address === 'string')
      throw new Error('Microsoft sign-in callback is not ready.')
    return `http://localhost:${address.port}`
  }

  closeServer(): void {
    this.closed = true
    this.settled = true
    this.rejectReady?.(new Error('Microsoft sign-in cancelled.'))
    this.rejectReady = undefined
    this.reject?.(new Error('Microsoft sign-in cancelled.'))
    this.reject = undefined
    this.server?.close()
    this.server?.closeAllConnections()
    this.server?.unref()
  }
}
