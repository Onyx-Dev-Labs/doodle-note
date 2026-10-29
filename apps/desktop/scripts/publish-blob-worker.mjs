// One SDK upload per worker. The parent awaits termination before settling,
// including when the SDK is sleeping inside async-retry after a request fails.
import { openAsBlob } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { put } from '@vercel/blob'

const controller = new AbortController()
parentPort.on('message', () => controller.abort(new DOMException('Upload cancelled', 'AbortError')))
try {
  const { key, sourceFile, body, options } = workerData
  const payload = sourceFile ? await openAsBlob(sourceFile) : body
  const result = await put(key, payload, { ...options, abortSignal: controller.signal })
  parentPort.postMessage({ result })
} catch (error) {
  parentPort.postMessage({ error: { name: error.name, message: error.message } })
}
