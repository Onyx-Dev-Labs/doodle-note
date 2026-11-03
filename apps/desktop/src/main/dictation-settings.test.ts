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
  assert.equal(settings.showTargetApp, true)
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
    showTargetApp: false,
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
  assert.equal(off.showTargetApp, false)
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

/* ---- tidy-up, styles, transforms ---- */

test('a new install tidies lightly, with the default tones and the shipped transforms off', () => {
  const settings = normalizeDictationSettings({})
  assert.equal(settings.tidyLevel, 'light')
  assert.deepEqual(settings.styles, {
    personal: 'relaxed',
    work: 'proper',
    email: 'proper',
    other: 'proper'
  })
  assert.deepEqual(settings.styleApps, { personal: [], work: [], email: [], other: [] })
  assert.equal(settings.transforms.enabled, false)
  assert.equal(settings.transforms.items.length, 5)
})

test('older files keep their meaning: a model cleanup mode becomes Full, raw becomes Light', () => {
  assert.equal(normalizeDictationSettings({ cleanupMode: 'local' }).tidyLevel, 'full')
  assert.equal(normalizeDictationSettings({ cleanupMode: 'byok' }).tidyLevel, 'full')
  assert.equal(normalizeDictationSettings({ cleanupMode: 'raw' }).tidyLevel, 'light')
  assert.equal(
    normalizeDictationSettings({ cleanupMode: 'local', tidyLevel: 'off' }).tidyLevel,
    'off'
  )
  assert.equal(
    normalizeDictationSettings({ cleanupMode: 'local' }).cleanupMode,
    'local',
    'still stored'
  )
  assert.equal(normalizeDictationSettings({ tidyLevel: 'extreme' }).tidyLevel, 'light')
})

test('style tones and app lists are validated and bounded', () => {
  const settings = normalizeDictationSettings({
    styles: { personal: 'lowercase', work: 'shouty', email: 7 },
    styleApps: {
      work: ['com.a.App', ' com.b.App ', 'com.a.app', 5, ''],
      personal: ['COM.A.APP', 'com.c.App'],
      other: 'nope'
    }
  })
  assert.deepEqual(settings.styles, {
    personal: 'lowercase',
    work: 'proper',
    email: 'proper',
    other: 'proper'
  })
  assert.deepEqual(settings.styleApps.work, ['com.b.App'])
  assert.deepEqual(settings.styleApps.personal, ['COM.A.APP', 'com.c.App'], 'an app has one home')
  assert.deepEqual(settings.styleApps.other, [])
  const crowded = normalizeDictationSettings({
    styleApps: { work: Array.from({ length: 80 }, (_, i) => `com.x.App${i}`) }
  })
  assert.equal(crowded.styleApps.work.length, 50)
})

test('transforms persist with their prompts and shortcuts, and never hold dictated text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-transforms-'))
  const store = new DictationSettingsStore(dir)
  store.update({
    tidyLevel: 'full',
    transforms: {
      enabled: true,
      autoApply: true,
      autoApplyId: 'mine',
      items: [
        {
          id: 'mine',
          name: 'Mine',
          prompt: 'Rewrite kindly.',
          hotkey: 'Control+Alt+9',
          keepFacts: false
        }
      ]
    }
  })
  const reloaded = new DictationSettingsStore(dir).get()
  assert.equal(reloaded.tidyLevel, 'full')
  assert.equal(reloaded.transforms.autoApplyId, 'mine')
  assert.equal(reloaded.transforms.items[0]!.hotkey, 'Control+Alt+9')
})

test('the dictionary persists, is validated on load, and a settings patch cannot replace it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-settings-'))
  const store = new DictationSettingsStore(dir)
  store.setDictionary([
    { id: 'a', from: 'alec', to: 'Alex', source: 'learned', count: 2, at: 5 },
    { id: 'b', from: '', to: 'DoodleNote', source: 'manual', count: 1, at: 6 }
  ])
  store.update({ dictionary: [], learnFromEdits: false })
  const reloaded = new DictationSettingsStore(dir).get()
  assert.equal(reloaded.dictionary.length, 2, 'a patch does not touch the dictionary')
  assert.equal(reloaded.learnFromEdits, false)
  assert.equal(normalizeDictationSettings({}).learnFromEdits, true, 'on by default')
  assert.deepEqual(normalizeDictationSettings({ dictionary: 'nope' }).dictionary, [])
  assert.equal(
    normalizeDictationSettings({ dictionary: [{ from: 'x', to: 'bad\nline' }] }).dictionary.length,
    0
  )
})

test('the word threshold for the model defaults to 12 and rejects nonsense', () => {
  assert.equal(normalizeDictationSettings({}).fullTidyMinWords, 12)
  assert.equal(normalizeDictationSettings({ fullTidyMinWords: 0 }).fullTidyMinWords, 0)
  assert.equal(normalizeDictationSettings({ fullTidyMinWords: 20 }).fullTidyMinWords, 20)
  for (const bad of [-1, 1.5, 201, '12', null, Number.NaN]) {
    assert.equal(
      normalizeDictationSettings({ fullTidyMinWords: bad }).fullTidyMinWords,
      12,
      String(bad)
    )
  }
})
