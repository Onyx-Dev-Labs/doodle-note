import assert from 'node:assert/strict'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  rm,
  stat,
  chmod,
  readFile,
  realpath
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { LocalModelSpec } from './catalog'
import { LocalModelStore } from './model-store'

// Stand-in for OS-protected storage; the encryption key never enters the cache.
const storageSecret = randomBytes(32)
const receiptStorage = {
  isEncryptionAvailable: () => true,
  encryptString(value: string): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', storageSecret, iv)
    const data = Buffer.concat([cipher.update(value), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), data])
  },
  decryptString(value: Buffer): string {
    const cipher = createDecipheriv('aes-256-gcm', storageSecret, value.subarray(0, 12))
    cipher.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString()
  }
}

const bytes = Buffer.from('GGUF synthetic model fixture')
const spec: LocalModelSpec = {
  id: 'fixture',
  label: 'Fast',
  description: 'fixture',
  sizeGB: 1,
  minRamGB: 8,
  uri: 'hf:test/fixture:Q4_K_M',
  artifact: {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    uri: 'hf:test/fixture/model.gguf#revision'
  }
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'doodle-model-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const current = join(root, 'current', 'models')
  const legacy = join(root, 'legacy', 'models')
  await mkdir(legacy, { recursive: true })
  return { current, legacy, store: new LocalModelStore([current, legacy]) }
}

test('reuses a legacy model without download or copy, including after restart', async (t) => {
  const { current, legacy, store } = await fixture(t)
  const file = join(legacy, 'renamed.gguf')
  await writeFile(file, bytes)
  const before = await stat(file)
  const download = async () => {
    throw new Error('must not download')
  }
  assert.equal(await store.ensure(spec, download), file)
  assert.equal(await new LocalModelStore([current, legacy]).find(spec), file)
  assert.equal((await stat(file)).ino, before.ino)
  await assert.rejects(readdir(current), { code: 'ENOENT' })
})

test('rechecks a previous miss immediately before activation', async (t) => {
  const { legacy, store } = await fixture(t)
  assert.equal(await store.find(spec), null)
  const file = join(legacy, 'model.gguf')
  await writeFile(file, bytes)
  assert.equal(
    await store.ensure(spec, async () => {
      throw new Error('download')
    }),
    file
  )
})

test('current compatible files win; wrong model identity never matches by name or size', async (t) => {
  const { current, legacy, store } = await fixture(t)
  await mkdir(current, { recursive: true })
  const file = join(current, 'model.gguf')
  await writeFile(file, bytes)
  await writeFile(join(legacy, 'model.gguf'), bytes)
  assert.equal(await store.find(spec), file)
  assert.equal(
    await store.find({
      ...spec,
      artifact: { ...spec.artifact, sha256: '0'.repeat(64) }
    }),
    null
  )
})

test('unreadable cache entries do not block a usable fallback', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0)
    return t.skip('POSIX permissions required')
  const { current, legacy, store } = await fixture(t)
  await mkdir(current, { recursive: true })
  const unreadable = join(current, 'model.gguf')
  await writeFile(unreadable, bytes)
  await chmod(unreadable, 0)
  t.after(() => chmod(unreadable, 0o600).catch(() => {}))
  const fallback = join(legacy, 'model.gguf')
  await writeFile(fallback, bytes)
  assert.equal(await store.find(spec), fallback)
})

test('rejects partial, corrupt, truncated and directory candidates', async (t) => {
  const { legacy, store } = await fixture(t)
  const file = join(legacy, 'model.gguf')
  await mkdir(file)
  assert.equal(await store.find(spec), null)
  await rm(file, { recursive: true })
  for (const invalid of [Buffer.alloc(0), bytes.subarray(0, 5), Buffer.alloc(bytes.length)]) {
    await writeFile(file, invalid)
    assert.equal(await store.find(spec), null)
  }
  await writeFile(file, bytes)
  await writeFile(`${file}.ipull`, '')
  assert.equal(await store.find(spec), null)
  await rm(`${file}.ipull`)
  assert.equal(await store.find(spec), file)
  await writeFile(file, Buffer.alloc(bytes.length))
  assert.equal(await store.find(spec), null, 'cached validation must not survive mutation')
})

test('publishes only verified downloads and coalesces repeated requests', async (t) => {
  const { current, store } = await fixture(t)
  let calls = 0
  const download = async (dir: string) => {
    calls++
    const file = join(dir, 'download.gguf')
    await writeFile(file, bytes)
    assert.equal(await store.find(spec), null, 'staging is not visible to discovery')
    return file
  }
  const [a, b] = await Promise.all([store.ensure(spec, download), store.ensure(spec, download)])
  assert.equal(a, b)
  assert.equal(calls, 1)
  assert.equal(await store.find(spec), a)
  assert.equal((await readdir(current)).length, 1)
})

test('failed or invalid downloads recover without changing existing files', async (t) => {
  const { current, legacy, store } = await fixture(t)
  const old = join(legacy, 'old.gguf')
  await writeFile(old, Buffer.alloc(bytes.length))
  await assert.rejects(
    store.ensure(spec, async () => {
      throw new Error('offline')
    }),
    /offline/
  )
  await assert.rejects(
    store.ensure(spec, async (dir) => {
      const file = join(dir, 'bad.gguf')
      await writeFile(file, Buffer.alloc(bytes.length))
      return file
    }),
    /verification/
  )
  assert.deepEqual(await readdir(current), [])
  assert.equal((await stat(old)).size, bytes.length)
  const good = join(legacy, 'good.gguf')
  await writeFile(good, bytes)
  assert.equal(await store.find(spec), good)
  await rm(good)
  assert.equal(await store.find(spec), null, 'removed shared references are not ready')
})

test('persists verdict across processes and rehashes any changed stamp or catalog digest', async (t) => {
  const { legacy } = await fixture(t)
  const file = join(legacy, 'model.gguf')
  const verdictPath = join(legacy, '..', 'profile', 'model-integrity.json')
  await writeFile(file, bytes)
  const checks: boolean[] = []
  const store = () =>
    new LocalModelStore([legacy], {
      verdictPath,
      receiptStorage,
      onIntegrityCheck: (event) => checks.push(event.cached)
    })
  assert.equal(await store().find(spec), file)
  assert.equal(await store().find(spec), file)
  assert.deepEqual(checks, [false, true])
  const { readFile, utimes, rename } = await import('node:fs/promises')
  const saved = JSON.parse(await readFile(verdictPath, 'utf8'))
  assert.deepEqual(
    Object.keys(saved[0]).sort(),
    ['version', 'mac', 'path', 'size', 'mtime', 'ctime', 'dev', 'ino', 'sha256'].sort()
  )
  for (const key of ['size', 'mtime', 'ctime', 'dev', 'ino']) {
    const stale = structuredClone(saved)
    stale[0][key] += 1
    await writeFile(verdictPath, JSON.stringify(stale))
    assert.equal(await store().find(spec), file)
    assert.equal(checks.at(-1), false, `${key} change must rehash`)
  }
  assert.equal(
    await store().find({
      ...spec,
      artifact: { ...spec.artifact, sha256: '0'.repeat(64) }
    }),
    null
  )
  const before = await stat(file)
  await writeFile(file, Buffer.alloc(bytes.length))
  await utimes(file, before.atime, before.mtime)
  assert.equal(
    await store().find(spec),
    null,
    'same-size edit/restored mtime must not bypass ctime'
  )
  await rename(file, `${file}.old`)
  await writeFile(file, bytes)
  assert.equal(await store().find(spec), file)
  assert.equal(checks.at(-1), false, 'replacement file rehashes')
  await writeFile(`${file}.ipull`, '')
  assert.equal(await store().find(spec), null, 'partial marker overrides persisted verdict')
})

test('corrupt, oversized or unwritable verdict file cannot prevent verification', async (t) => {
  const { legacy } = await fixture(t)
  const file = join(legacy, 'model.gguf'),
    verdictPath = join(legacy, 'verdict.json')
  await writeFile(file, bytes)
  for (const invalid of [
    '{',
    '{}',
    '[null]',
    JSON.stringify([{ path: file }]),
    ' '.repeat(65537)
  ]) {
    await writeFile(verdictPath, invalid)
    const checks: boolean[] = []
    assert.equal(
      await new LocalModelStore([legacy], {
        verdictPath,
        receiptStorage,
        onIntegrityCheck: (event) => checks.push(event.cached)
      }).find(spec),
      file
    )
    assert.deepEqual(checks, [false])
  }
  await rm(verdictPath)
  await mkdir(verdictPath)
  assert.equal(await new LocalModelStore([legacy], { verdictPath }).find(spec), file)
  assert.equal(
    (await readdir(legacy)).some((name) => name.endsWith('.tmp')),
    false
  )
})

test('well-formed forged and retargeted receipts cannot authorize wrong bytes', async (t) => {
  const { legacy } = await fixture(t)
  const good = join(legacy, 'good.gguf')
  const wrong = join(legacy, 'wrong.gguf')
  const verdictPath = join(legacy, 'verdict.json')
  await writeFile(good, bytes)
  const store = (checks: boolean[]) =>
    new LocalModelStore([legacy], {
      verdictPath,
      receiptStorage,
      onIntegrityCheck: (e) => checks.push(e.cached)
    })
  assert.equal(await store([]).find(spec), good)
  const original = JSON.parse(await readFile(verdictPath, 'utf8'))[0]
  const key = receiptStorage.decryptString(await readFile(`${verdictPath}.key`))
  assert.ok(!(await readFile(verdictPath, 'utf8')).includes(key))
  assert.ok(!(await readFile(`${verdictPath}.key`)).includes(Buffer.from(key)))
  await rm(good)
  await writeFile(wrong, Buffer.alloc(bytes.length, 88))
  const file = await stat(wrong)
  const forged = {
    version: 1,
    mac: '0'.repeat(64),
    path: await realpath(wrong),
    size: file.size,
    mtime: file.mtimeMs,
    ctime: file.ctimeMs,
    dev: file.dev,
    ino: file.ino,
    sha256: spec.artifact.sha256
  }
  for (const receipt of [forged, { ...forged, mac: original.mac }, { ...original, version: 2 }]) {
    await writeFile(verdictPath, JSON.stringify([receipt]))
    const checks: boolean[] = []
    assert.equal(await store(checks).find(spec), null)
    assert.deepEqual(checks, [false])
  }
})

test('unavailable storage, plaintext backend, changed key and decryption failure all rehash', async (t) => {
  const { legacy } = await fixture(t)
  const file = join(legacy, 'model.gguf')
  const verdictPath = join(legacy, 'verdict.json')
  await writeFile(file, bytes)
  await new LocalModelStore([legacy], { verdictPath, receiptStorage }).find(spec)
  const checks: boolean[] = []
  for (const storage of [
    undefined,
    { ...receiptStorage, isEncryptionAvailable: () => false },
    { ...receiptStorage, getSelectedStorageBackend: () => 'basic_text' },
    {
      ...receiptStorage,
      decryptString: () => {
        throw new Error('DPAPI unavailable')
      }
    },
    { ...receiptStorage, decryptString: () => randomBytes(32).toString('hex') }
  ]) {
    assert.equal(
      await new LocalModelStore([legacy], {
        verdictPath,
        receiptStorage: storage,
        onIntegrityCheck: (e) => checks.push(e.cached)
      }).find(spec),
      file
    )
    assert.equal(checks.at(-1), false)
  }
})
