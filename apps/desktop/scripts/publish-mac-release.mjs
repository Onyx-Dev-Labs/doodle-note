// Receipt-bound Mac promotion. Importing this module performs no I/O.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream, openAsBlob } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'

// Must match the installed updater URL and the web artifact proxy's store.
export const BLOB_BASE = 'https://z4d0oe5bcxlyzvar.public.blob.vercel-storage.com/updates'
export const PUBLIC_BASE = 'https://www.doodlenote.ai/updates'

const feed = 'latest-mac.yml'
const attestation =
  'Verified app/ZIP/DMG payloads, signatures, tickets, Gatekeeper, version and manifest SHA-512 hashes.'

async function digest(stream, limit = Infinity) {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) throw new Error('Payload exceeds expected size')
    hash.update(chunk)
  }
  return { sha256: hash.digest('hex'), size }
}

function receiptHashes(text, version, sourceSha, names) {
  const lines = text.trimEnd().split('\n')
  if (
    lines.length !== 7 ||
    lines[0] !== `Source commit: ${sourceSha}` ||
    lines[1] !== `Version: ${version}` ||
    lines[2] !== 'Signing team: VTZW6K32K4' ||
    lines[3] !== attestation
  )
    throw new Error('Receipt identity/format mismatch')
  const hashes = new Map()
  for (const line of lines.slice(4)) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
    const name = match && path.posix.basename(match[2])
    if (!names.includes(name) || hashes.has(name))
      throw new Error('Unexpected/duplicate receipt payload')
    hashes.set(name, match[1])
  }
  return hashes
}

function checkLocation(blob, name) {
  // DNS hostnames are case-insensitive; the SDK preserves the store ID's casing.
  // Only normalize the authority, leaving the exact path/query/fragment checks intact.
  const canonicalUrl =
    typeof blob.url === 'string'
      ? blob.url.replace(/^https:\/\/[^/]+/, (authority) => authority.toLowerCase())
      : null
  if (blob.pathname !== `updates/${name}` || canonicalUrl !== `${BLOB_BASE}/${name}`) {
    throw new Error(`Unexpected Blob store/path for ${name}; check the upload token's store`)
  }
}

async function readBlob(transport, name) {
  const result = await transport.get(`updates/${name}`)
  if (result) {
    try {
      checkLocation(result.blob, name)
    } catch (error) {
      await result.stream?.cancel()
      throw error
    }
  }
  return result
}

async function verifyBytes(stream, entry) {
  if (!stream) throw new Error(`Missing response body: ${entry.name}`)
  const actual = await digest(stream, entry.size)
  if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) {
    throw new Error(
      `Payload hash/size conflict: ${entry.name}; never overwrite immutable artifacts`
    )
  }
}

async function verifyPublic(transport, url, entry) {
  const response = await transport.fetch(url, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(300_000)
  })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error(`Public verification HTTP ${response.status}: ${url}`)
  }
  await verifyBytes(response.body, entry)
}

async function ensureArtifact(transport, entry, sleep) {
  const key = `updates/${entry.name}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await readBlob(transport, entry.name)
    if (existing) {
      await verifyBytes(existing.stream, entry)
      break
    }
    try {
      // File-backed Blob is replayable even inside SDK retries; a consumed
      // ReadStream is not. Each outer attempt also opens a new body.
      const body = await openAsBlob(entry.file)
      const uploaded = await transport.put(key, body, {
        sourceFile: entry.file,
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: false,
        abortSignal: AbortSignal.timeout(300_000)
      })
      checkLocation(uploaded, entry.name)
      break
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        throw new Error(
          `Upload cancelled: ${entry.name}; remote upload may have completed; feeds unchanged. Inspect before rerunning the same receipt.`,
          { cause: error }
        )
      }
      // A lost acknowledgement or competing writer can leave an object behind.
      // Resolve by bytes, never by an SDK error-message substring or overwrite.
      const current = await readBlob(transport, entry.name)
      if (current) {
        await verifyBytes(current.stream, entry)
        break
      }
      if (attempt === 2)
        throw new Error(
          `Upload failed: ${entry.name}; feeds unchanged; rerun with the same receipt`,
          { cause: error }
        )
      await sleep(1000 * (attempt + 1))
    }
  }
  // Anonymous reads exercise both the raw object and the actual client route.
  await verifyPublic(transport, `${BLOB_BASE}/${entry.name}`, entry)
  await verifyPublic(transport, `${PUBLIC_BASE}/${entry.name}`, entry)
}

function uploadInWorker(key, body, options) {
  const { sourceFile, abortSignal = AbortSignal.timeout(300_000), ...sdkOptions } = options
  const cancelled = () =>
    new DOMException('Blob upload deadline/cancellation; SDK worker terminated', 'AbortError')
  if (abortSignal.aborted) return Promise.reject(cancelled())
  const worker = new Worker(new URL('./publish-blob-worker.mjs', import.meta.url), {
    // File-backed Blobs cannot be cloned. Reopen the same validated snapshot
    // inside the worker; small manifest buffers are cloned without a live stream.
    workerData: { key, sourceFile, body: sourceFile ? undefined : body, options: sdkOptions },
    execArgv: []
  })
  return new Promise((resolve, reject) => {
    let stopping = false
    const finish = async (error, result) => {
      if (stopping) return
      stopping = true
      try {
        // This is a cleanup barrier, not Promise.race: no SDK request or retry
        // timer remains running when the caller resumes or removes its snapshot.
        await worker.terminate()
        if (abortSignal.aborted) reject(cancelled())
        else if (error) reject(error)
        else resolve(result)
      } catch (cleanupError) {
        reject(cleanupError)
      } finally {
        abortSignal.removeEventListener('abort', abort)
      }
    }
    const abort = () => {
      worker.postMessage('abort') // normalize cancellation to the SDK's AbortError
      void finish(cancelled()) // also stop an already-running SDK retry delay
    }
    worker.once('message', ({ result, error }) => {
      void finish(
        error ? Object.assign(new Error(error.message), { name: error.name }) : null,
        result
      )
    })
    worker.once('error', (error) => {
      void finish(error)
    })
    worker.once('exit', (code) => {
      void finish(new Error(`Blob upload worker exited without a result (${code})`))
    })
    abortSignal.addEventListener('abort', abort, { once: true })
    if (abortSignal.aborted) abort()
  })
}

export async function createBlobTransport() {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token)
    throw new Error(
      'BLOB_READ_WRITE_TOKEN must be supplied by the environment; Mac promotion does not read .env files'
    )
  const { get } = await import('@vercel/blob')
  return {
    get: (key) =>
      get(key, {
        access: 'public',
        useCache: false,
        token,
        abortSignal: AbortSignal.timeout(300_000)
      }),
    put: (key, body, options) => uploadInWorker(key, body, { ...options, token }),
    fetch: (url, options) => fetch(url, options)
  }
}

async function readOptional(file) {
  try {
    return await readFile(file)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function activateFeed(transport, entry, { rollbackDir, webUpdatesDir, sourceSha }) {
  const key = `updates/${feed}`
  const candidate = await readFile(entry.file)
  const current = await readBlob(transport, feed)
  let previous = null
  if (current) {
    if (!current.blob.etag) {
      await current.stream?.cancel()
      throw new Error('Feed has no ETag; refusing unconditional activation')
    }
    const chunks = []
    let size = 0
    for await (const chunk of current.stream) {
      size += chunk.length
      if (size > 1024 * 1024) throw new Error('Previous feed exceeds 1 MiB')
      chunks.push(chunk)
    }
    previous = Buffer.concat(chunks)
  }
  const webFile = path.join(webUpdatesDir, feed)
  const previousWeb = await readOptional(webFile)
  await mkdir(rollbackDir, { recursive: true })
  // Never replace an earlier rollback record, including on a resumed activation.
  const backupDir = await mkdtemp(path.join(rollbackDir, 'mac-activation-'))
  if (previous)
    await writeFile(path.join(backupDir, 'blob-latest-mac.yml'), previous, { flag: 'wx' })
  if (previousWeb)
    await writeFile(path.join(backupDir, 'web-latest-mac.yml'), previousWeb, { flag: 'wx' })
  await writeFile(path.join(backupDir, 'candidate-latest-mac.yml'), candidate, { flag: 'wx' })
  await writeFile(
    path.join(backupDir, 'activation.json'),
    JSON.stringify(
      {
        sourceSha,
        candidateSha256: entry.sha256,
        previousBlobEtag: current?.blob.etag ?? null,
        previousBlobAbsent: previous === null,
        previousWebAbsent: previousWeb === null,
        webFile,
        blobUrl: `${BLOB_BASE}/${feed}`
      },
      null,
      2
    ) + '\n',
    { flag: 'wx' }
  )

  let activationAttempted = false
  try {
    // Even identical observed bytes need CAS: public CDN reads can be stale.
    // Never turn a cached candidate into permission to stage over a newer feed.
    activationAttempted = true
    const uploaded = await transport.put(key, Buffer.from(candidate), {
      access: 'public',
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      allowOverwrite: !!current,
      ...(current ? { ifMatch: current.blob.etag } : {}),
      abortSignal: AbortSignal.timeout(300_000)
    })
    checkLocation(uploaded, feed)
    const activated = await readBlob(transport, feed)
    if (!activated) throw new Error('Activated feed is missing')
    await verifyBytes(activated.stream, entry)
    await verifyPublic(transport, `${BLOB_BASE}/${feed}`, entry)
    // A read/check/rename cannot provide CAS against arbitrary filesystem writers.
    // Return a unique proposal for reviewed manual replacement instead.
    const stagedManifest = path.join(backupDir, 'web-proposal-latest-mac.yml')
    await writeFile(stagedManifest, candidate, { flag: 'wx' })
    return { backupDir, stagedManifest }
  } catch (error) {
    throw new Error(
      `${activationAttempted ? 'Blob feed may be active; static feed remains untouched.' : 'Feed activation not attempted.'} ` +
        `Retain rollback records at ${backupDir}. Inspect live Blob/static feeds before retrying; restore only with the current ETag and reviewed prior web manifest. See docs/qa/mac-publisher.md. ${error.message}`,
      { cause: error }
    )
  }
}

export async function publishMacRelease({
  releaseDir,
  version,
  sourceSha,
  dryRun = false,
  dmgOnly = false,
  activate = false,
  rollbackDir,
  webUpdatesDir,
  transport,
  sleep = delay
}) {
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '') ||
    !/^[0-9a-f]{40}$/.test(sourceSha ?? '')
  ) {
    throw new Error(
      'Explicit version and exact --source-sha (40 lowercase hex characters) required'
    )
  }
  if (activate && (dmgOnly || !rollbackDir || !webUpdatesDir)) {
    throw new Error(
      'Activation requires --rollback-dir and a web staging directory, and cannot use --dmg-only'
    )
  }
  const names = [`DoodleNote-${version}-arm64-mac.zip`, `DoodleNote-${version}-arm64.dmg`, feed]
  const hashes = receiptHashes(
    await readFile(path.join(releaseDir, 'release-receipt.txt'), 'utf8'),
    version,
    sourceSha,
    names
  )
  // Snapshot first; receipt checks, manifest checks and uploads use the same bytes.
  const snapshot = await mkdtemp(path.join(os.tmpdir(), 'doodlenote-publish-'))
  try {
    const entries = []
    for (const name of names) {
      const source = path.join(releaseDir, name)
      if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${name}`)
      const file = path.join(snapshot, name)
      await copyFile(source, file, constants.COPYFILE_FICLONE)
      const actual = await digest(createReadStream(file))
      if (actual.sha256 !== hashes.get(name)) throw new Error(`Receipt SHA-256 mismatch: ${name}`)
      entries.push({ name, file, ...actual })
    }
    const check = spawnSync(
      'ruby',
      [fileURLToPath(new URL('./mac-release-manifest.rb', import.meta.url)), snapshot, version],
      { encoding: 'utf8', timeout: 120_000 }
    )
    if (check.status !== 0)
      throw new Error(`Manifest validation failed: ${check.error?.message ?? check.stderr}`)
    const artifacts = entries.slice(dmgOnly ? 1 : 0, 2)
    const result = {
      sourceSha,
      version,
      artifacts: artifacts.map(({ name, sha256, size }) => ({ name, sha256, size })),
      activated: false
    }
    if (dryRun) return result
    transport ??= await createBlobTransport()
    for (const entry of artifacts) await ensureArtifact(transport, entry, sleep)
    if (activate) {
      Object.assign(
        result,
        await activateFeed(transport, entries[2], {
          rollbackDir,
          webUpdatesDir,
          sourceSha
        })
      )
      result.activated = true
    }
    return result
  } finally {
    await rm(snapshot, { recursive: true, force: true })
  }
}
