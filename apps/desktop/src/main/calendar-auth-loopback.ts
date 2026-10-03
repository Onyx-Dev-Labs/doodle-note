import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { ILoopbackClient } from '@azure/msal-node'

/** A cancellable MSAL loopback listener. MSAL retains ownership of PKCE and token exchange. */
export class CalendarAuthLoopback implements ILoopbackClient {
  readonly state = randomBytes(32).toString('base64url')
  private server?: Server
  private reject?: (error: Error) => void
  private closed = false

  listenForAuthCode(
    successTemplate = '',
    errorTemplate = ''
  ): ReturnType<ILoopbackClient['listenForAuthCode']> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Microsoft sign-in cancelled.'))
        return
      }
      this.reject = reject
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
        if (url.searchParams.get('state') !== this.state) {
          response.writeHead(400).end(errorTemplate)
          return
        }
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (!code && !error) {
          response.writeHead(400).end(errorTemplate)
          return
        }
        response.writeHead(302, { Location: this.getRedirectUri() }).end()
        this.reject = undefined
        if (error) reject(new Error('Microsoft sign-in was not completed. Try again.'))
        else
          resolve({
            code: code!,
            state: this.state,
            client_info: url.searchParams.get('client_info') ?? undefined
          })
      })
      this.server.once('error', () =>
        reject(new Error('Microsoft sign-in could not open its local callback. Try again.'))
      )
      this.server.listen(0, '127.0.0.1')
    })
  }

  getRedirectUri(): string {
    const address = this.server?.address()
    if (!address || typeof address === 'string')
      throw new Error('Microsoft sign-in callback is not ready.')
    return `http://localhost:${address.port}`
  }

  closeServer(): void {
    this.closed = true
    this.reject?.(new Error('Microsoft sign-in cancelled.'))
    this.reject = undefined
    this.server?.close()
    this.server?.closeAllConnections()
    this.server?.unref()
    this.server = undefined
  }
}
