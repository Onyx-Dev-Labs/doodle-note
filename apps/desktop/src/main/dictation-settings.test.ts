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
  assert.equal(settings.showLiveText, true)
  assert.equal(settings.showStatusMessages, true)
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
    showLiveText: false,
    showStatusMessages: false,
    microphoneUid: '',
    pillHiddenUntil: Number.NaN
  })
  assert.equal(off.showPill, false)
  assert.equal(off.startSound, false)
  assert.equal(off.handsFreeDoubleTap, false)
  assert.equal(off.pasteLastShortcut, '', 'empty disables the shortcut')
  assert.equal(off.copyLastShortcut, '')
  assert.equal(off.showLiveText, false)
  assert.equal(off.showStatusMessages, false)
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

test('the mouse trigger is off by default and swallows its button when it can', () => {
  const settings = normalizeDictationSettings({})
  assert.equal(settings.holdMouseButton, null)
  assert.equal(settings.holdMouseSwallow, true)
})

test('the mouse button defaults to click-to-start-and-stop and only knows two modes', () => {
  assert.equal(normalizeDictationSettings({}).holdMouseMode, 'click')
  assert.equal(normalizeDictationSettings({ holdMouseMode: 'hold' }).holdMouseMode, 'hold')
  assert.equal(normalizeDictationSettings({ holdMouseMode: 'click' }).holdMouseMode, 'click')
  for (const junk of ['toggle', 1, null, true, {}]) {
    assert.equal(normalizeDictationSettings({ holdMouseMode: junk }).holdMouseMode, 'click')
  }
  const dir = mkdtempSync(join(tmpdir(), 'dictation-mode-'))
  new DictationSettingsStore(dir).update({ holdMouseButton: 3, holdMouseMode: 'hold' })
  assert.equal(new DictationSettingsStore(dir).get().holdMouseMode, 'hold')
})

test('left and right click and non-buttons are never accepted as the mouse trigger', () => {
  for (const value of [0, 1, -1, 32, 2.5, '3', Number.NaN, null, true, {}]) {
    assert.equal(
      normalizeDictationSettings({ holdMouseButton: value }).holdMouseButton,
      null,
      `${String(value)} must not stick`
    )
  }
  for (const value of [2, 3, 4, 5, 31]) {
    assert.equal(normalizeDictationSettings({ holdMouseButton: value }).holdMouseButton, value)
  }
})

test('the mouse trigger persists, clears, and coexists with the hold key and the shortcuts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-mouse-'))
  const store = new DictationSettingsStore(dir)
  store.update({ holdKey: 'fn', holdMouseButton: 4, holdMouseSwallow: false })
  const reloaded = new DictationSettingsStore(dir).get()
  assert.equal(reloaded.holdKey, 'fn', 'the keyboard trigger is untouched')
  assert.equal(reloaded.holdMouseButton, 4)
  assert.equal(reloaded.holdMouseSwallow, false)
  assert.equal(reloaded.toggleShortcut, DEFAULT_DICTATION_SETTINGS.toggleShortcut)
  store.update({ holdMouseButton: 1 })
  assert.equal(store.get().holdMouseButton, null, 'a left or right click is rejected on update')
  store.update({ holdMouseButton: 3 })
  store.update({ holdMouseButton: null })
  assert.equal(new DictationSettingsStore(dir).get().holdMouseButton, null)
  assert.equal(new DictationSettingsStore(dir).get().holdKey, 'fn')
})
