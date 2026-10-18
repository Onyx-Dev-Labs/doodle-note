import { Worker } from 'node:worker_threads'

// Fixed, input-independent worker program. It does no filesystem work and cannot publish a revision.
const program = `
const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
parentPort.on('message', message => {
  try {
    let result;
    if (message.op === 'decode') {
      const bytes = Buffer.from(message.bytes);
      result = { value: JSON.parse(bytes.toString('utf8')), digest: hash(bytes) };
    } else if (message.op === 'encode') {
      const serialized = JSON.stringify(message.value);
      result = { serialized, digest: hash(serialized), bytes: Buffer.byteLength(serialized) };
    } else if (message.op === 'hash') result = hash(Buffer.from(message.bytes));
    else throw new Error('Unknown calendar codec operation');
    parentPort.postMessage({ id: message.id, result });
  } catch { parentPort.postMessage({ id: message.id, error: 'Calendar context JSON could not be processed. Existing bytes were preserved.' }); }
});
`

/** JSON/hashing runs away from live capture. Main retains schema, lifetime and atomic commit ownership. */
export class CalendarContextCodec {
  private worker?: Worker
  private closed = false
  private nextId = 0
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private fail(error: Error): void {
    this.closed = true
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
  private request<T>(op: string, value?: unknown, bytes?: Buffer): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Calendar context codec is closed.'))
    if (!this.worker) {
      this.worker = new Worker(program, { eval: true })
      this.worker.on('message', (message: { id: number; result?: unknown; error?: string }) => {
        const request = this.pending.get(message.id)
        if (!request) return
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error))
        else request.resolve(message.result)
        if (!this.pending.size) this.worker?.unref()
      })
      this.worker.on('error', (error) => this.fail(error))
      this.worker.on('exit', () => this.fail(new Error('Calendar context codec is closed.')))
    }
    this.worker.ref()
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject })
      try {
        // Buffers can share slabs; copy into an exclusively owned transfer buffer.
        const transferable = bytes ? Uint8Array.from(bytes).buffer : undefined
        this.worker!.postMessage(
          { id, op, value, bytes: transferable },
          transferable ? [transferable] : []
        )
      } catch (error) {
        this.pending.delete(id)
        if (!this.pending.size) this.worker?.unref()
        reject(error)
      }
    })
  }
  decode(bytes: Buffer): Promise<{ value: unknown; digest: string }> {
    return this.request('decode', undefined, bytes)
  }
  encode(value: unknown): Promise<{ serialized: string; bytes: number; digest: string }> {
    return this.request('encode', value)
  }
  hash(bytes: Buffer): Promise<string> {
    return this.request('hash', undefined, bytes)
  }
  async close(): Promise<void> {
    this.fail(new Error('Calendar context codec is closed.'))
    await this.worker?.terminate()
  }
}
