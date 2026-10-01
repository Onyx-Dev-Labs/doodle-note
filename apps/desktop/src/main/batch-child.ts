import { spawn } from 'node:child_process'

/** Cancellation completes only after close, so jobs never release a live child. */
export function runBatchChild(
  binary: string,
  args: string[],
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let stderr = ''
    let failure: Error | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000)
    }
    const timeout = setTimeout(() => {
      failure = new Error('Batch transcription timed out.')
      stop()
    }, 30 * 60_000)
    const abort = (): void => {
      failure = new Error('Import canceled.')
      failure.name = 'AbortError'
      stop()
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
      if (output.length > 8 * 1024 * 1024) {
        failure = new Error('Engine output exceeded its limit.')
        stop()
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => {
      failure = error
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (code !== 0)
        reject(new Error(`Local transcription engine failed (${code}). ${stderr.slice(-600)}`))
      else resolve(output)
    })
  })
}
