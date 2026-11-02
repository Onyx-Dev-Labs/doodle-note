import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_DICTATION_SETTINGS } from '../shared/dictation-api'
import { DictationSettingsStore, normalizeDictationSettings } from './dictation-settings'

test('an old settings file gains the pill defaults and keeps what it had', () => {
  const settings = normalizeDictationSettings({
    enabled: true,
    toggleShortcut: 'Control+Alt+X',
    holdKey: 'fn',
    cleanupMode: 'local'
  })
  assert.equal(settings.enabled, true)
  assert.equal(settings.toggleShortcut, 'Control+Alt+X')
  assert.equal(settings.holdKey, 'fn')
  assert.equal(settings.showPill, true)
  assert.equal(settings.pillEdge, 'bottom')
  assert.equal(settings.pillHiddenUntil, null)
  assert.equal(settings.microphoneUid, null)
  assert.equal(settings.startSound, true)
  assert.equal(settings.handsFreeDoubleTap, true)
  assert.equal(settings.pasteLastShortcut, DEFAULT_DICTATION_SETTINGS.pasteLastShortcut)
  assert.equal(settings.copyLastShortcut, 'Control+Alt+Shift+C')
})

test('the default shortcuts do not collide with each other', () => {
  const keys = [
    DEFAULT_DICTATION_SETTINGS.toggleShortcut,
    DEFAULT_DICTATION_SETTINGS.pasteLastShortcut,
    DEFAULT_DICTATION_SETTINGS.copyLastShortcut
  ].map((key) => key.toLowerCase())
  assert.equal(new Set(keys).size, 3)
})

test('garbage values fall back; explicit false and empty values are kept', () => {
  const bad = normalizeDictationSettings({
    pillEdge: 'top',
    pillHiddenUntil: 'soon',
    microphoneUid: 42,
    pasteLastShortcut: 'x'.repeat(100),
    copyLastShortcut: 7
  })
  assert.equal(bad.copyLastShortcut, DEFAULT_DICTATION_SETTINGS.copyLastShortcut)
  assert.equal(bad.pillEdge, 'bottom')
  assert.equal(bad.pillHiddenUntil, null)
  assert.equal(bad.microphoneUid, null)
  assert.equal(bad.pasteLastShortcut, DEFAULT_DICTATION_SETTINGS.pasteLastShortcut)
  const off = normalizeDictationSettings({
    showPill: false,
    startSound: false,
    handsFreeDoubleTap: false,
    pasteLastShortcut: '',
    copyLastShortcut: '',
    microphoneUid: '',
    pillHiddenUntil: Number.NaN
  })
  assert.equal(off.showPill, false)
  assert.equal(off.startSound, false)
  assert.equal(off.handsFreeDoubleTap, false)
  assert.equal(off.pasteLastShortcut, '', 'empty disables the shortcut')
  assert.equal(off.copyLastShortcut, '')
  assert.equal(off.microphoneUid, null)
  assert.equal(off.pillHiddenUntil, null)
})

test('the pill choices persist across a restart; a damaged file falls back to defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-settings-'))
  const store = new DictationSettingsStore(dir)
  store.update({ pillEdge: 'left', pillHiddenUntil: 1_234_567, microphoneUid: 'usb-1' })
  const reloaded = new DictationSettingsStore(dir).get()
  assert.equal(reloaded.pillEdge, 'left')
  assert.equal(reloaded.pillHiddenUntil, 1_234_567)
  assert.equal(reloaded.microphoneUid, 'usb-1')
  writeFileSync(join(dir, 'dictation.json'), '{ not json')
  assert.equal(new DictationSettingsStore(dir).get().pillEdge, 'bottom')
})
