import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertIsolatedFromProduction, planProfile } from './profile-identity'

const base = {
  isPackaged: true,
  appData: '/Users/t/Library/Application Support',
  home: '/Users/t',
  env: {}
}

test('dev lineage gets its own profile, logs and no updater', () => {
  const plan = planProfile({ ...base, channel: 'dev' })
  assert.equal(plan.userData, '/Users/t/Library/Application Support/DoodleNote Dev')
  assert.equal(plan.logs, '/Users/t/Library/Logs/DoodleNote Dev')
  assert.equal(plan.appName, 'DoodleNote Dev')
  assert.equal(plan.updatesEnabled, false)
  assert.equal(plan.adoptLegacyData, false)
})

test('dev lineage ignores DOODLE_USER_DATA even when packaged or unpackaged', () => {
  for (const isPackaged of [true, false]) {
    const plan = planProfile({
      ...base,
      isPackaged,
      channel: 'dev',
      env: { DOODLE_USER_DATA: '/Users/t/Library/Application Support/DoodleNote' }
    })
    assert.equal(plan.userData, '/Users/t/Library/Application Support/DoodleNote Dev')
  }
})

test('production lineage keeps the existing behavior exactly', () => {
  const packaged = planProfile({
    ...base,
    channel: 'release',
    env: { DOODLE_USER_DATA: '/tmp/x' }
  })
  assert.equal(packaged.userData, null, 'packaged production ignores the variable')
  assert.equal(packaged.updatesEnabled, true)
  assert.equal(packaged.adoptLegacyData, true)
  const unpackaged = planProfile({
    ...base,
    isPackaged: false,
    channel: 'release',
    env: { DOODLE_USER_DATA: '/tmp/x' }
  })
  assert.equal(unpackaged.userData, '/tmp/x')
})

test('an overlapping profile directory is rejected', () => {
  const root = '/Users/t/Library/Application Support'
  assert.throws(() => assertIsolatedFromProduction(`${root}/DoodleNote`, root))
  assert.throws(() => assertIsolatedFromProduction(`${root}/desktop/inner`, root))
  assert.doesNotThrow(() => assertIsolatedFromProduction(`${root}/DoodleNote Dev`, root))
})
