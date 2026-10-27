import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { BLOB_BASE, PUBLIC_BASE, publishMacRelease } from './publish-mac-release.mjs'

const version = '0.4.35'
const sourceSha = '89e28173363fa1263156096d42df8a9baeac7bea'
const zip = `DoodleNote-${version}-arm64-mac.zip`
const dmg = `DoodleNote-${version}-arm64.dmg`
const feed = 'latest-mac.yml'
const hash = (data, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(data).digest(encoding)

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publisher-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const files = {
    [zip]: Buffer.from('signed zip fixture'),
    [dmg]: Buffer.from('stapled dmg fixture')
  }
  files[feed] = Buffer.from(
    `---\nversion: ${version}\nfiles:\n` +
      [zip, dmg]
        .map(
          (name) =>
            `- url: ${name}\n  sha512: ${hash(files[name], 'sha512', 'base64')}\n  size: ${files[name].length}\n`
        )
        .join('') +
      `path: ${zip}\nsha512: ${hash(files[zip], 'sha512', 'base64')}\nreleaseDate: '2026-10-20T17:45:43.968Z'\n`
  )
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(dir, name), data)
  const receipt =
    `Source commit: ${sourceSha}\nVersion: ${version}\nSigning team: VTZW6K32K4\n` +
    'Verified app/ZIP/DMG payloads, signatures, tickets, Gatekeeper, version and manifest SHA-512 hashes.\n' +
    Object.entries(files)
      .map(([name, data]) => `${hash(data)}  /runner/release/${name}\n`)
      .join('')
  await writeFile(path.join(dir, 'release-receipt.txt'), receipt)
  return { dir, files, receipt, options: { releaseDir: dir, version, sourceSha } }
}

test('dry run validates receipt and manifest without transport or staging', async (t) => {
  const f = await fixture(t)
  const result = await publishMacRelease({ ...f.options, dryRun: true })
  assert.deepEqual(
    result.artifacts.map((a) => a.name),
    [zip, dmg]
  )
  assert.equal(result.activated, false)
  assert.equal(result.sourceSha, sourceSha)
  assert.deepEqual(await readFile(path.join(f.dir, zip)), f.files[zip])
})

function fakeTransport() {
  const objects = new Map()
  const events = []
  let generation = 0
  return {
    objects,
    events,
    async get(key) {
      events.push(['get', key])
      const object = objects.get(key)
      return object
        ? {
            statusCode: 200,
            stream: new Response(object.bytes).body,
            blob: { url: `${BLOB_BASE}/${key.slice(8)}`, pathname: key, etag: object.etag }
          }
        : null
    },
    async put(key, body, options) {
      events.push(['put', key, options])
      const existing = objects.get(key)
      if (existing && (!options.allowOverwrite || options.ifMatch !== existing.etag))
        throw new Error('Conflict')
      if (!existing && options.ifMatch) throw new Error('Precondition failed')
      const bytes = Buffer.from(await new Response(body).arrayBuffer())
      const etag = `"generation-${++generation}"`
      objects.set(key, { bytes, etag })
      return { url: `${BLOB_BASE}/${key.slice(8)}`, pathname: key, etag }
    },
    async fetch(url) {
      events.push(['public', url])
      assert.ok(url.startsWith(`${BLOB_BASE}/`) || url.startsWith(`${PUBLIC_BASE}/`))
      const object = objects.get(`updates/${url.split('/').at(-1)}`)
      return new Response(object?.bytes ?? 'Not found', { status: object ? 200 : 404 })
    }
  }
}

test('uploads only exact payloads, verifies public bytes, and leaves feeds untouched by default', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.dir, 'DoodleNote-0.4.350-arm64.dmg'), 'wrong version')
  await writeFile(path.join(f.dir, 'latest.yml'), 'Windows feed')
  const transport = fakeTransport()
  const result = await publishMacRelease({ ...f.options, transport })
  assert.equal(result.activated, false)
  assert.deepEqual([...transport.objects.keys()], [`updates/${zip}`, `updates/${dmg}`])
  for (const name of [zip, dmg]) {
    assert.deepEqual(transport.objects.get(`updates/${name}`).bytes, f.files[name])
    assert.ok(transport.events.some((e) => e[0] === 'public' && e[1] === `${PUBLIC_BASE}/${name}`))
  }
  assert.ok(
    transport.events.filter((e) => e[0] === 'put').every((e) => e[2].allowOverwrite === false)
  )
})

test('activation is last and conditional, with prior manifests saved and a separate static proposal', async (t) => {
  const f = await fixture(t)
  const transport = fakeTransport()
  transport.objects.set(`updates/${feed}`, {
    bytes: Buffer.from('old Blob feed'),
    etag: 'old-etag'
  })
  const webUpdatesDir = path.join(f.dir, 'web')
  await mkdir(webUpdatesDir)
  await writeFile(path.join(webUpdatesDir, feed), 'old static feed')
  const put = transport.put.bind(transport)
  transport.put = async (key, body, options) => {
    if (key === `updates/${feed}`) {
      const [backup] = await readdir(path.join(f.dir, 'rollback'))
      assert.equal(
        await readFile(path.join(f.dir, 'rollback', backup, 'blob-latest-mac.yml'), 'utf8'),
        'old Blob feed'
      )
      assert.equal(
        await readFile(path.join(f.dir, 'rollback', backup, 'web-latest-mac.yml'), 'utf8'),
        'old static feed'
      )
    }
    return put(key, body, options)
  }
  const result = await publishMacRelease({
    ...f.options,
    transport,
    activate: true,
    rollbackDir: path.join(f.dir, 'rollback'),
    webUpdatesDir
  })
  assert.equal(result.activated, true)
  assert.equal(
    await readFile(path.join(result.backupDir, 'blob-latest-mac.yml'), 'utf8'),
    'old Blob feed'
  )
  assert.equal(
    await readFile(path.join(result.backupDir, 'web-latest-mac.yml'), 'utf8'),
    'old static feed'
  )
  assert.equal(await readFile(path.join(webUpdatesDir, feed), 'utf8'), 'old static feed')
  assert.deepEqual(await readFile(result.stagedManifest), f.files[feed])
  const puts = transport.events.filter((e) => e[0] === 'put')
  assert.deepEqual(
    puts.map((e) => e[1]),
    [`updates/${zip}`, `updates/${dmg}`, `updates/${feed}`]
  )
  assert.equal(puts.at(-1)[2].ifMatch, 'old-etag')
  const activation = transport.events.findIndex((e) => e[0] === 'put' && e[1] === `updates/${feed}`)
  for (const name of [zip, dmg]) {
    assert.ok(
      transport.events.findIndex((e) => e[0] === 'public' && e[1] === `${PUBLIC_BASE}/${name}`) <
        activation
    )
  }
})

for (const damage of [
  'wrong source',
  'wrong team',
  'duplicate digest',
  'missing payload',
  'wrong digest',
  'symlink',
  'bad manifest'
]) {
  test(`rejects ${damage} before any transport call`, async (t) => {
    const f = await fixture(t)
    if (damage === 'wrong source') f.options.sourceSha = 'a'.repeat(40)
    if (damage === 'wrong team')
      await writeFile(
        path.join(f.dir, 'release-receipt.txt'),
        f.receipt.replace('VTZW6K32K4', 'AAAAAAAAAA')
      )
    if (damage === 'duplicate digest')
      await writeFile(path.join(f.dir, 'release-receipt.txt'), f.receipt.replace(dmg, zip))
    if (damage === 'missing payload') await rm(path.join(f.dir, dmg))
    if (damage === 'wrong digest') await writeFile(path.join(f.dir, zip), 'changed signed bytes')
    if (damage === 'symlink') {
      await rm(path.join(f.dir, zip))
      await symlink(path.join(f.dir, dmg), path.join(f.dir, zip))
    }
    if (damage === 'bad manifest') {
      const bad = Buffer.from(f.files[feed].toString().replace(`path: ${zip}`, `path: ../${zip}`))
      await writeFile(path.join(f.dir, feed), bad)
      await writeFile(
        path.join(f.dir, 'release-receipt.txt'),
        f.receipt.replace(hash(f.files[feed]), hash(bad))
      )
    }
    const transport = fakeTransport()
    await assert.rejects(publishMacRelease({ ...f.options, transport }))
    assert.deepEqual(transport.events, [])
  })
}

test('matching immutable objects are reused without writes; different bytes are never overwritten', async (t) => {
  const f = await fixture(t)
  const transport = fakeTransport()
  for (const name of [zip, dmg])
    transport.objects.set(`updates/${name}`, { bytes: f.files[name], etag: name })
  await publishMacRelease({ ...f.options, transport })
  assert.equal(transport.events.filter((e) => e[0] === 'put').length, 0)
  transport.objects.set(`updates/${zip}`, {
    bytes: Buffer.from('conflicting bytes'),
    etag: 'other'
  })
  await assert.rejects(publishMacRelease({ ...f.options, transport }), /hash\/size conflict/)
  assert.equal(transport.events.filter((e) => e[0] === 'put').length, 0)
  assert.equal(transport.objects.get(`updates/${zip}`).bytes.toString(), 'conflicting bytes')
})

test('a fully consumed failed upload retries with a fresh replayable body and bounded attempts', async (t) => {
  const f = await fixture(t)
  const transport = fakeTransport()
  const put = transport.put.bind(transport)
  const bodies = []
  transport.put = async (key, body, options) => {
    if (key === `updates/${zip}`) {
      bodies.push(body)
      assert.deepEqual(Buffer.from(await body.arrayBuffer()), f.files[zip])
      // Simulate the SDK replaying a body inside one put() too.
      assert.deepEqual(Buffer.from(await new Response(body).arrayBuffer()), f.files[zip])
      if (bodies.length === 1) throw new Error('Connection lost after full body consumption')
    }
    return put(key, body, options)
  }
  await publishMacRelease({ ...f.options, transport, sleep: async () => {} })
  assert.equal(bodies.length, 2)
  assert.notEqual(bodies[0], bodies[1])
  assert.deepEqual(transport.objects.get(`updates/${zip}`).bytes, f.files[zip])

  const failing = fakeTransport()
  let attempts = 0
  failing.put = async () => {
    attempts++
    throw new Error('Offline')
  }
  await assert.rejects(
    publishMacRelease({ ...f.options, transport: failing, sleep: async () => {} }),
    /feeds unchanged/
  )
  assert.equal(attempts, 3)
})

for (const sameBytes of [true, false]) {
  test(`lost upload acknowledgement / concurrent writer is resolved by bytes (matching=${sameBytes})`, async (t) => {
    const f = await fixture(t)
    const transport = fakeTransport()
    const put = transport.put.bind(transport)
    transport.put = async (key, body, options) => {
      await put(key, body, options)
      if (!sameBytes) transport.objects.get(key).bytes = Buffer.from('racing writer')
      throw new Error('Lost acknowledgement')
    }
    const promise = publishMacRelease({ ...f.options, transport })
    if (sameBytes) await promise
    else await assert.rejects(promise, /hash\/size conflict/)
    assert.ok(
      transport.events.filter((e) => e[0] === 'put').every((e) => e[2].allowOverwrite === false)
    )
    assert.equal(transport.objects.has(`updates/${feed}`), false)
  })
}

async function activationOptions(f) {
  const webUpdatesDir = path.join(f.dir, 'web')
  await mkdir(webUpdatesDir)
  await writeFile(path.join(webUpdatesDir, feed), 'old static feed')
  return { ...f.options, activate: true, rollbackDir: path.join(f.dir, 'rollback'), webUpdatesDir }
}

for (const failure of ['404', '403', 'truncated', 'different', 'too large', 'stream error']) {
  test(`public client payload ${failure} blocks both feed surfaces`, async (t) => {
    const f = await fixture(t)
    const options = await activationOptions(f)
    const transport = fakeTransport()
    const fetch = transport.fetch.bind(transport)
    transport.fetch = async (url) => {
      if (url === `${PUBLIC_BASE}/${dmg}`) {
        if (failure === '404' || failure === '403')
          return new Response('error', { status: Number(failure) })
        if (failure === 'stream error')
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('connection lost'))
              }
            })
          )
        const bytes =
          failure === 'truncated'
            ? f.files[dmg].subarray(0, 3)
            : Buffer.alloc(f.files[dmg].length + (failure === 'too large' ? 1 : 0))
        return new Response(bytes)
      }
      return fetch(url)
    }
    await assert.rejects(publishMacRelease({ ...options, transport }))
    assert.equal(transport.objects.has(`updates/${feed}`), false)
    assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'old static feed')
  })
}

for (const failure of ['concurrent activation', 'lost acknowledgement', 'stale public feed']) {
  test(`activation ${failure} retains rollback evidence and does not stage the static feed`, async (t) => {
    const f = await fixture(t)
    const options = await activationOptions(f)
    const transport = fakeTransport()
    transport.objects.set(`updates/${feed}`, {
      bytes: Buffer.from('old Blob feed'),
      etag: 'old-etag'
    })
    const put = transport.put.bind(transport)
    const fetch = transport.fetch.bind(transport)
    transport.put = async (key, body, config) => {
      if (key !== `updates/${feed}`) return put(key, body, config)
      if (failure === 'concurrent activation')
        transport.objects.set(key, { bytes: Buffer.from('another release'), etag: 'new-etag' })
      const result = await put(key, body, config)
      if (failure === 'lost acknowledgement') throw new Error('Lost acknowledgement')
      return result
    }
    transport.fetch = (url) =>
      failure === 'stale public feed' && url === `${BLOB_BASE}/${feed}`
        ? Promise.resolve(new Response('old Blob feed'))
        : fetch(url)
    await assert.rejects(publishMacRelease({ ...options, transport }), (asyncError) => {
      assert.match(asyncError.message, /Blob feed may be active; static feed remains untouched/)
      assert.match(asyncError.message, /Retain rollback records at/)
      return true
    })
    const [backup] = await readdir(options.rollbackDir)
    assert.equal(
      await readFile(path.join(options.rollbackDir, backup, 'blob-latest-mac.yml'), 'utf8'),
      'old Blob feed'
    )
    assert.deepEqual(
      await readFile(path.join(options.rollbackDir, backup, 'candidate-latest-mac.yml')),
      f.files[feed]
    )
    assert.deepEqual(await readdir(options.webUpdatesDir), [feed])
    assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'old static feed')
    if (failure === 'concurrent activation')
      assert.equal(transport.objects.get(`updates/${feed}`).bytes.toString(), 'another release')
  })
}

test('DMG-only backfill never uploads a ZIP or activates/stages a feed', async (t) => {
  const f = await fixture(t)
  const transport = fakeTransport()
  await publishMacRelease({ ...f.options, dmgOnly: true, transport })
  assert.deepEqual([...transport.objects.keys()], [`updates/${dmg}`])
  await assert.rejects(
    publishMacRelease({ ...f.options, dmgOnly: true, activate: true, transport }),
    /cannot use --dmg-only/
  )
})

test('first activation creates the absent feed without overwrite and records absence', async (t) => {
  const f = await fixture(t)
  const options = await activationOptions(f)
  const transport = fakeTransport()
  const result = await publishMacRelease({ ...options, transport })
  const activation = transport.events.find((e) => e[0] === 'put' && e[1] === `updates/${feed}`)
  assert.equal(activation[2].allowOverwrite, false)
  assert.equal(activation[2].ifMatch, undefined)
  assert.equal(
    JSON.parse(await readFile(path.join(result.backupDir, 'activation.json'))).previousBlobAbsent,
    true
  )
})

test('missing feed ETag refuses activation instead of falling back to unconditional overwrite', async (t) => {
  const f = await fixture(t)
  const options = await activationOptions(f)
  const transport = fakeTransport()
  transport.objects.set(`updates/${feed}`, { bytes: Buffer.from('old feed'), etag: '' })
  await assert.rejects(publishMacRelease({ ...options, transport }), /no ETag/)
  assert.equal(
    transport.events.filter((e) => e[0] === 'put' && e[1] === `updates/${feed}`).length,
    0
  )
  assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'old static feed')
})

test('upload uses the validated snapshot even if the source package changes later', async (t) => {
  const f = await fixture(t)
  const transport = fakeTransport()
  const get = transport.get.bind(transport)
  transport.get = async (key) => {
    await writeFile(path.join(f.dir, zip), 'modified after preflight')
    return get(key)
  }
  await publishMacRelease({ ...f.options, transport })
  assert.deepEqual(transport.objects.get(`updates/${zip}`).bytes, f.files[zip])
})

test('CLI dry run needs no token, preserves candidate bytes, and rejects ambiguous/unknown flags', async (t) => {
  const f = await fixture(t)
  const script = new URL('./publish-release.mjs', import.meta.url)
  const env = { PATH: process.env.PATH, HOME: f.dir }
  const run = (args) =>
    spawnSync(process.execPath, [script.pathname, ...args], { env, encoding: 'utf8' })
  const result = run(['--mac', '--source-sha', sourceSha, '--release-dir', f.dir, '--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Local validation only/)
  assert.deepEqual(await readFile(path.join(f.dir, feed)), f.files[feed])
  for (const args of [
    [],
    ['--mac', '--win'],
    ['--mac', '--surprise'],
    ['--mac', '--source-sha'],
    ['--win', '--dry-run']
  ]) {
    assert.notEqual(run(args).status, 0)
  }
})

test('a cached identical manifest cannot bypass a conditional activation against a newer live feed', async (t) => {
  const f = await fixture(t)
  const options = await activationOptions(f)
  const transport = fakeTransport()
  transport.objects.set(`updates/${feed}`, {
    bytes: Buffer.from('newer live feed'),
    etag: 'newer-etag'
  })
  const get = transport.get.bind(transport)
  const fetch = transport.fetch.bind(transport)
  transport.get = (key) =>
    key === `updates/${feed}`
      ? Promise.resolve({
          stream: new Response(f.files[feed]).body,
          blob: { url: `${BLOB_BASE}/${feed}`, pathname: key, etag: 'cached-etag' }
        })
      : get(key)
  transport.fetch = (url) =>
    url === `${BLOB_BASE}/${feed}` ? Promise.resolve(new Response(f.files[feed])) : fetch(url)
  await assert.rejects(publishMacRelease({ ...options, transport }), /Blob feed may be active/)
  assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'old static feed')
  assert.equal(transport.objects.get(`updates/${feed}`).bytes.toString(), 'newer live feed')
})

test('locked Blob SDK replays file bytes on HTTP retry and sends immutable/CAS headers (loopback only)', async (t) => {
  const f = await fixture(t)
  // Separate process: never inherit credentials, SDK endpoint overrides, or a
  // global dispatcher from the developer's shell/test runner.
  const probe = `
    import assert from 'node:assert/strict'
    import { createServer } from 'node:http'
    import { openAsBlob } from 'node:fs'
    import { createRequire } from 'node:module'
    import { createBlobTransport, BLOB_BASE } from './scripts/publish-mac-release.mjs'
    const require = createRequire(import.meta.resolve('@vercel/blob'))
    const { MockAgent, setGlobalDispatcher } = require('undici')
    const mock = new MockAgent()
    mock.disableNetConnect()
    mock.enableNetConnect(host => host.startsWith('127.0.0.1:'))
    setGlobalDispatcher(mock)
    const requests = []
    const server = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      requests.push({ bytes: Buffer.concat(chunks), headers: request.headers })
      response.setHeader('Content-Type', 'application/json')
      if (requests.length === 1) {
        response.statusCode = 503
        response.end(JSON.stringify({ error: { code: 'service_unavailable' } }))
      } else {
        response.end(JSON.stringify({ url: BLOB_BASE + '/probe.zip', pathname: 'updates/probe.zip', etag: 'new-etag' }))
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    process.env.VERCEL_BLOB_API_URL = 'http://127.0.0.1:' + server.address().port
    try {
      const transport = await createBlobTransport()
      const body = await openAsBlob(${JSON.stringify(path.join(f.dir, zip))})
      await transport.put('updates/probe.zip', body, {
        sourceFile: ${JSON.stringify(path.join(f.dir, zip))},
        access: 'public', addRandomSuffix: false, allowOverwrite: false,
        abortSignal: AbortSignal.timeout(10000)
      })
      assert.equal(requests.length, 2)
      for (const request of requests) {
        assert.equal(request.bytes.toString(), 'signed zip fixture')
        assert.equal(request.headers['x-allow-overwrite'], '0')
        assert.equal(request.headers['x-add-random-suffix'], '0')
      }
      await transport.put('updates/latest-mac.yml', Buffer.from('manifest'), {
        access: 'public', addRandomSuffix: false, allowOverwrite: true,
        ifMatch: 'previous-etag', cacheControlMaxAge: 60
      })
      assert.equal(requests[2].headers['x-if-match'], 'previous-etag')
      assert.equal(requests[2].headers['x-cache-control-max-age'], '60')
      const origin = new URL(BLOB_BASE).origin
      mock.get(origin).intercept({ path: '/updates/probe.zip', method: 'GET' }).reply(200, 'payload', { headers: { etag: 'read-etag' } })
      const read = await transport.get('updates/probe.zip')
      assert.equal(read.blob.etag, 'read-etag')
      assert.equal(await new Response(read.stream).text(), 'payload')
      mock.assertNoPendingInterceptors()
    } finally {
      await new Promise(resolve => server.close(resolve))
      await mock.close()
    }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: process.env.PATH,
      HOME: f.dir,
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_z4d0oe5bcxlyzvar_test-only-not-a-secret',
      VERCEL_BLOB_RETRIES: '1'
    }
  })
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`)
})

test('explicit --win preserves legacy Windows selection/options/staging and never selects Mac files', async (t) => {
  const f = await fixture(t)
  const desktop = path.join(f.dir, 'apps', 'desktop')
  const scripts = path.join(desktop, 'scripts')
  const release = path.join(desktop, 'release')
  const sdk = path.join(desktop, 'node_modules', '@vercel', 'blob')
  for (const dir of [scripts, release, sdk]) await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(scripts, 'publish-release.mjs'),
    await readFile(new URL('./publish-release.mjs', import.meta.url))
  )
  await writeFile(
    path.join(scripts, 'publish-mac-release.mjs'),
    'export function publishMacRelease() { throw new Error("Mac must not run") }'
  )
  await writeFile(path.join(desktop, 'package.json'), JSON.stringify({ version }))
  await writeFile(
    path.join(sdk, 'package.json'),
    JSON.stringify({ type: 'module', exports: './index.js' })
  )
  await writeFile(
    path.join(sdk, 'index.js'),
    `
    import { appendFile } from 'node:fs/promises'
    export async function put(key, stream, options) {
      let body = ''
      for await (const chunk of stream) body += chunk
      await appendFile(process.env.TEST_LOG, JSON.stringify({ key, body, options }) + '\\n')
      return { url: 'https://fake.invalid/' + key }
    }
  `
  )
  const installer = `DoodleNote-${version}-setup.exe`
  const windows = {
    [installer]: 'exe bytes',
    [`${installer}.blockmap`]: 'blockmap',
    'latest.yml': 'Windows manifest'
  }
  for (const [name, bytes] of Object.entries({
    ...windows,
    ...f.files,
    'DoodleNote-0.4.33-setup.exe': 'old installer'
  })) {
    await writeFile(path.join(release, name), bytes)
  }
  const log = path.join(f.dir, 'writes.jsonl')
  const result = spawnSync(process.execPath, [path.join(scripts, 'publish-release.mjs'), '--win'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: f.dir,
      BLOB_READ_WRITE_TOKEN: 'fake-test-token',
      TEST_LOG: log
    }
  })
  assert.equal(result.status, 0, result.stderr)
  const writes = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    writes.map((w) => w.key).sort(),
    Object.keys(windows)
      .map((name) => `updates/${name}`)
      .sort()
  )
  for (const write of writes) {
    assert.equal(write.body, windows[write.key.slice(8)])
    assert.deepEqual(write.options, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(write.key.endsWith('.yml') ? { cacheControlMaxAge: 60 } : {})
    })
  }
  assert.equal(
    await readFile(path.join(f.dir, 'apps/web/public/updates/latest.yml'), 'utf8'),
    'Windows manifest'
  )
  await assert.rejects(readFile(path.join(f.dir, 'apps/web/public/updates/latest-mac.yml')), {
    code: 'ENOENT'
  })
})

// Deterministic interleaving from both independent F1 probes: the read has
// obtained the old bytes, then another writer edits before the publisher resumes.
test('an edit after the final static read survives activation and the candidate remains a separate proposal', async (t) => {
  const { default: fsPromises } = await import('node:fs/promises')
  const { syncBuiltinESMExports } = await import('node:module')
  const f = await fixture(t)
  const options = await activationOptions(f)
  const webFile = path.join(options.webUpdatesDir, feed)
  const originalRead = fsPromises.readFile
  let reads = 0
  fsPromises.readFile = async (...args) => {
    const bytes = await originalRead(...args)
    if (args[0] === webFile && ++reads === 2)
      await writeFile(webFile, 'concurrent edit after final read')
    return bytes
  }
  syncBuiltinESMExports()
  try {
    const result = await publishMacRelease({ ...options, transport: fakeTransport() })
    assert.equal(result.activated, true)
    assert.ok(reads > 0)
    assert.equal(
      await originalRead(webFile, 'utf8'),
      reads === 2 ? 'concurrent edit after final read' : 'old static feed'
    )
    assert.notEqual(result.stagedManifest, webFile)
    assert.deepEqual(await originalRead(result.stagedManifest), f.files[feed])
  } finally {
    fsPromises.readFile = originalRead
    syncBuiltinESMExports()
  }
})

for (const mode of ['active', 'retry-delay']) {
  test(`locked SDK deadline terminates ${mode} and prevents later requests`, async (t) => {
    const f = await fixture(t)
    const result = spawnSync(
      process.execPath,
      [
        new URL('./publish-blob-deadline-probe.mjs', import.meta.url).pathname,
        mode,
        path.join(f.dir, zip)
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          PATH: process.env.PATH,
          HOME: f.dir,
          BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_z4d0oe5bcxlyzvar_test-only-not-a-secret',
          VERCEL_BLOB_RETRIES: '1'
        }
      }
    )
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`)
    console.log(result.stdout.trim())
  })
}

test('an edit during remote activation is preserved alongside the unique static proposal', async (t) => {
  const f = await fixture(t)
  const options = await activationOptions(f)
  const transport = fakeTransport()
  const put = transport.put.bind(transport)
  transport.put = async (key, body, config) => {
    const result = await put(key, body, config)
    if (key === `updates/${feed}`)
      await writeFile(path.join(options.webUpdatesDir, feed), 'maintainer edit')
    return result
  }
  const result = await publishMacRelease({ ...options, transport })
  assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'maintainer edit')
  assert.deepEqual(await readFile(result.stagedManifest), f.files[feed])
  assert.equal(
    await readFile(path.join(result.backupDir, 'web-latest-mac.yml'), 'utf8'),
    'old static feed'
  )
})

test('cancelled payload stops the publish run without a later retry or activation', async (t) => {
  const f = await fixture(t)
  const options = await activationOptions(f)
  const transport = fakeTransport()
  const put = transport.put.bind(transport)
  transport.put = async (key, body, config) => {
    await put(key, body, config)
    throw new DOMException('Worker deadline', 'AbortError')
  }
  await assert.rejects(
    publishMacRelease({ ...options, transport, sleep: async () => {} }),
    /remote upload may have completed; feeds unchanged/
  )
  assert.deepEqual(
    transport.events.filter((e) => e[0] === 'put').map((e) => e[1]),
    [`updates/${zip}`]
  )
  assert.equal(transport.objects.has(`updates/${feed}`), false)
  assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'old static feed')
})

test('cancelled manifest preserves ambiguous-activation recovery evidence and offers no verified proposal', async (t) => {
  const f = await fixture(t)
  const options = await activationOptions(f)
  const transport = fakeTransport()
  transport.objects.set(`updates/${feed}`, {
    bytes: Buffer.from('old Blob feed'),
    etag: 'old-etag'
  })
  const put = transport.put.bind(transport)
  transport.put = async (key, body, config) => {
    const result = await put(key, body, config)
    if (key === `updates/${feed}`)
      throw new DOMException('Worker deadline after remote commit', 'AbortError')
    return result
  }
  await assert.rejects(
    publishMacRelease({ ...options, transport }),
    /Blob feed may be active; static feed remains untouched.*Retain rollback records/s
  )
  const [backup] = await readdir(options.rollbackDir)
  assert.equal(
    await readFile(path.join(options.rollbackDir, backup, 'blob-latest-mac.yml'), 'utf8'),
    'old Blob feed'
  )
  assert.deepEqual(
    await readFile(path.join(options.rollbackDir, backup, 'candidate-latest-mac.yml')),
    f.files[feed]
  )
  await assert.rejects(
    readFile(path.join(options.rollbackDir, backup, 'web-proposal-latest-mac.yml')),
    { code: 'ENOENT' }
  )
  assert.equal(await readFile(path.join(options.webUpdatesDir, feed), 'utf8'), 'old static feed')
  assert.deepEqual(transport.objects.get(`updates/${feed}`).bytes, f.files[feed])
})
