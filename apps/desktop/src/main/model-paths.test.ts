import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { modelSearchDirectories } from './model-paths'

test('isolated profiles search the real application-data root, without importing settings', () => {
  const paths = modelSearchDirectories(
    join('isolated', 'profile'),
    join('user', 'appData'),
    'fallback'
  )
  assert.deepEqual(paths, [
    join('isolated', 'profile', 'models'),
    join('user', 'appData', 'DoodleNote', 'models'),
    join('user', 'appData', 'desktop', 'models'),
    join('user', 'appData', 'DoodleNote Local', 'models'),
    'fallback'
  ])
})

test('current packaged profile is searched once and before other profiles', () => {
  const paths = modelSearchDirectories(join('root', 'DoodleNote'), 'root', 'fallback')
  assert.equal(paths[0], join('root', 'DoodleNote', 'models'))
  assert.equal(paths.length, 4)
})

test('a QA identity searches only its own profile, never production or the shared cache', () => {
  const qaProfile = join('user', 'appData', 'desktop-qa')
  assert.deepEqual(modelSearchDirectories(qaProfile, join('user', 'appData'), 'fallback', 'qa'), [
    join(qaProfile, 'models')
  ])
  // Production is unchanged.
  assert.equal(
    modelSearchDirectories(qaProfile, join('user', 'appData'), 'fallback', 'production').length,
    5
  )
})
