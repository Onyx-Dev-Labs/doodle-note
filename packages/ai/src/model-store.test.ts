import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readdir, rm, stat, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { LocalModelSpec } from './catalog'
import { LocalModelStore } from './model-store'

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
    await store.find({ ...spec, artifact: { ...spec.artifact, sha256: '0'.repeat(64) } }),
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
