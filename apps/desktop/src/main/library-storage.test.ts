import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  renameSync,
  symlinkSync,
  realpathSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LIBRARY_ENTRIES, LibraryStorage } from './library-storage'

function fixture(t: { after(fn: () => void): void }): {
  root: string
  profile: string
  destination: string
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'doodle-storage-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile')
  const destination = join(root, 'External drive Café')
  mkdirSync(profile)
  mkdirSync(destination)
  return { root, profile, destination }
}

test('copy, verify and switch the complete content library on next launch; retain source and private settings', async (t) => {
  const { profile, destination } = fixture(t)
  for (const name of LIBRARY_ENTRIES) {
    if (name.endsWith('.json'))
      writeFileSync(join(profile, name), JSON.stringify({ fixture: name }))
    else {
      mkdirSync(join(profile, name, 'meeting-1'), { recursive: true })
      writeFileSync(join(profile, name, 'meeting-1', 'fixture'), `synthetic ${name}`)
    }
  }
  for (const name of [
    'settings.json',
    'sync.json',
    'google-token-cache',
    'folders-not-library.json'
  ]) {
    writeFileSync(join(profile, name), 'private fixture')
  }
  mkdirSync(join(profile, 'models'))
  writeFileSync(join(profile, 'models', 'model.gguf'), 'model fixture')
  const storage = new LibraryStorage(profile)
  const pending = storage.schedule(destination)
  assert.equal(pending.currentPath, profile)
  assert.equal(existsSync(join(destination, 'DoodleNote Library')), false)
  const nextLaunch = new LibraryStorage(profile)
  await nextLaunch.finishPending()
  const target = join(destination, 'DoodleNote Library')
  assert.equal(nextLaunch.root, target)
  assert.equal(nextLaunch.status().pendingPath, undefined)
  assert.equal(nextLaunch.status().recoveryPath, profile)
  for (const name of LIBRARY_ENTRIES) {
    const file = name.endsWith('.json') ? name : join(name, 'meeting-1', 'fixture')
    assert.equal(
      readFileSync(join(target, file), 'utf8'),
      readFileSync(join(profile, file), 'utf8')
    )
  }
  assert.equal(existsSync(join(target, 'settings.json')), false)
  assert.equal(existsSync(join(target, 'sync.json')), false)
  assert.equal(existsSync(join(target, 'google-token-cache')), false)
  assert.equal(existsSync(join(target, 'models')), false)
  writeFileSync(join(target, 'meetings', 'new-note.json'), '{"id":"new-note"}')
  const restart = new LibraryStorage(profile)
  await restart.finishPending()
  assert.equal(restart.root, target)
  assert.equal(existsSync(join(profile, 'meetings', 'new-note.json')), false)
})

test('empty library transfers and canceling a selection never copies or switches files', async (t) => {
  const { profile, destination } = fixture(t)
  const storage = new LibraryStorage(profile)
  storage.schedule(destination)
  storage.cancel()
  await new LibraryStorage(profile).finishPending()
  assert.equal(existsSync(join(destination, 'DoodleNote Library')), false)
  storage.schedule(destination)
  await storage.finishPending()
  storage.assertAvailable()
  assert.equal(storage.root, join(destination, 'DoodleNote Library'))
})

test('reject overlap, existing libraries and symlink destinations without replacing data', (t) => {
  const { profile, destination, root } = fixture(t)
  const storage = new LibraryStorage(profile)
  assert.throws(() => storage.schedule(profile), /overlap/)
  mkdirSync(join(destination, 'DoodleNote Library'))
  writeFileSync(join(destination, 'DoodleNote Library', 'keep'), 'existing')
  assert.throws(() => storage.schedule(destination), /already contains/)
  const alias = join(root, 'alias')
  if (process.platform !== 'win32') {
    symlinkSync(destination, alias)
    assert.throws(() => storage.schedule(alias))
  }
  assert.equal(readFileSync(join(destination, 'DoodleNote Library', 'keep'), 'utf8'), 'existing')
  assert.equal(storage.status().pendingPath, undefined)
})

test('an unavailable destination preserves the source and pending choice for retry/cancel', async (t) => {
  const { profile, destination } = fixture(t)
  writeFileSync(join(profile, 'folders.json'), '[]')
  const storage = new LibraryStorage(profile)
  storage.schedule(destination)
  renameSync(destination, destination + '-disconnected')
  await assert.rejects(storage.finishPending())
  assert.equal(storage.root, profile)
  assert.ok(storage.status().pendingPath)
  assert.equal(readFileSync(join(profile, 'folders.json'), 'utf8'), '[]')
  assert.equal(existsSync(destination), false)
  renameSync(destination + '-disconnected', destination)
  await storage.finishPending()
  assert.equal(storage.root, join(destination, 'DoodleNote Library'))
})

test('unplugged or replaced active storage fails closed across restart and never falls back', async (t) => {
  const { profile, destination } = fixture(t)
  const storage = new LibraryStorage(profile)
  storage.schedule(destination)
  await storage.finishPending()
  const active = storage.root
  renameSync(active, active + '-disconnected')
  assert.throws(() => storage.assertAvailable(), /unavailable/)
  await assert.rejects(new LibraryStorage(profile).finishPending(), /unavailable/)
  assert.equal(existsSync(active), false)
  mkdirSync(active)
  assert.throws(() => new LibraryStorage(profile).assertAvailable(), /unavailable/)
  rmSync(active, { recursive: true })
  renameSync(active + '-disconnected', active)
  new LibraryStorage(profile).assertAvailable()
})

test(
  'source symlinks are rejected without switching or copying private outside files',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { profile, destination, root } = fixture(t)
    const secret = join(root, 'outside')
    writeFileSync(secret, 'outside fixture')
    mkdirSync(join(profile, 'meetings'))
    symlinkSync(secret, join(profile, 'meetings', 'link.json'))
    const storage = new LibraryStorage(profile)
    storage.schedule(destination)
    await assert.rejects(storage.finishPending(), /link or unsupported/)
    assert.equal(storage.root, profile)
    assert.equal(existsSync(join(destination, 'DoodleNote Library')), false)
  }
)

test('destination populated after scheduling is never overwritten', async (t) => {
  const { profile, destination } = fixture(t)
  const storage = new LibraryStorage(profile)
  storage.schedule(destination)
  const target = join(destination, 'DoodleNote Library')
  mkdirSync(target)
  writeFileSync(join(target, 'keep'), 'keep')
  await assert.rejects(storage.finishPending(), /no longer empty/)
  assert.equal(storage.root, profile)
  assert.equal(readFileSync(join(target, 'keep'), 'utf8'), 'keep')
})

test('corrupt configuration does not silently choose a fresh default', (t) => {
  const { profile } = fixture(t)
  writeFileSync(join(profile, 'library-location.json'), '{broken')
  assert.throws(() => new LibraryStorage(profile))
  writeFileSync(join(profile, 'library-location.json'), JSON.stringify({ version: 2 }))
  assert.throws(() => new LibraryStorage(profile), /invalid/)
})

test('resume after rename/config-commit interruption verifies content before activating', async (t) => {
  const { profile, destination } = fixture(t)
  writeFileSync(join(profile, 'folders.json'), '[]')
  const storage = new LibraryStorage(profile)
  storage.schedule(destination)
  const pendingConfig = readFileSync(storage.configPath)
  await storage.finishPending()
  writeFileSync(storage.configPath, pendingConfig)
  const recovered = new LibraryStorage(profile)
  await recovered.finishPending()
  assert.equal(recovered.root, join(destination, 'DoodleNote Library'))
  writeFileSync(storage.configPath, pendingConfig)
  writeFileSync(join(profile, 'folders.json'), '["changed"]')
  await assert.rejects(new LibraryStorage(profile).finishPending(), /no longer matches/)
})

test('a second transfer preserves the current library and never recopies the stale original', async (t) => {
  const { profile, destination, root } = fixture(t)
  const storage = new LibraryStorage(profile)
  storage.schedule(destination)
  await storage.finishPending()
  writeFileSync(join(storage.root, 'folders.json'), '["current"]')
  const second = join(root, 'second')
  mkdirSync(second)
  const previous = storage.root
  storage.schedule(second)
  await storage.finishPending()
  assert.equal(storage.status().recoveryPath, previous)
  assert.equal(readFileSync(join(storage.root, 'folders.json'), 'utf8'), '["current"]')
  assert.equal(existsSync(join(profile, 'folders.json')), false)
})

test('insufficient space is rejected before copying and leaves original active', async (t) => {
  const { profile, destination } = fixture(t)
  writeFileSync(join(profile, 'folders.json'), '[]')
  const storage = new LibraryStorage(profile, { freeBytes: async () => 0 })
  storage.schedule(destination)
  await assert.rejects(storage.finishPending(), /not enough free space/)
  assert.equal(storage.root, profile)
  assert.equal(existsSync(join(destination, 'DoodleNote Library')), false)
})

test('interrupted copy is retried from intact source without adopting a partial library', async (t) => {
  const { profile, destination } = fixture(t)
  writeFileSync(join(profile, 'folders.json'), '[]')
  const storage = new LibraryStorage(profile, {
    copyFile: async () => {
      throw new Error('simulated I/O failure')
    }
  })
  storage.schedule(destination)
  await assert.rejects(storage.finishPending(), /simulated I\/O failure/)
  assert.equal(storage.root, profile)
  assert.equal(readFileSync(join(profile, 'folders.json'), 'utf8'), '[]')
  const retry = new LibraryStorage(profile)
  await retry.finishPending()
  assert.equal(readFileSync(join(retry.root, 'folders.json'), 'utf8'), '[]')
})

test('a corrupted copy fails verification and never switches the active library', async (t) => {
  const { profile, destination } = fixture(t)
  writeFileSync(join(profile, 'folders.json'), '["original"]')
  const storage = new LibraryStorage(profile, {
    copyFile: async (_source, target) => {
      writeFileSync(target, '["corrupt"]')
    }
  })
  storage.schedule(destination)
  await assert.rejects(storage.finishPending(), /verification failed/)
  assert.equal(storage.root, profile)
  assert.equal(readFileSync(join(profile, 'folders.json'), 'utf8'), '["original"]')
  assert.equal(existsSync(join(destination, 'DoodleNote Library')), false)
})
