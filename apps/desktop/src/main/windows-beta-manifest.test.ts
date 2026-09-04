import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsBetaManifests } from '../../scripts/windows-beta-manifest.mjs'

test('Windows beta publication serves the updater channel and website alias', () => {
  const source = [
    'version: 0.4.20',
    'files:',
    '  - url: DoodleNote-0.4.20-setup.exe',
    'path: DoodleNote-0.4.20-setup.exe',
    ''
  ].join('\n')

  assert.deepEqual(buildWindowsBetaManifests(source, 'DoodleNote-0.4.20-setup.exe'), [
    {
      pathname: 'updates/beta.yml',
      body: source.replaceAll('DoodleNote-0.4.20-setup.exe', 'DoodleNote-0.4.20-beta-setup.exe')
    },
    {
      pathname: 'updates/latest-beta.yml',
      body: source.replaceAll('DoodleNote-0.4.20-setup.exe', 'DoodleNote-0.4.20-beta-setup.exe')
    }
  ])
})
