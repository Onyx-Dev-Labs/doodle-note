import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BrowserWindow } from 'electron'
import {
  isDictationWindow,
  onlyDictationWindowsRemain,
  tagDictationWindow
} from './dictation-windows'

const fakeWindow = (): BrowserWindow => ({}) as unknown as BrowserWindow

test('a window is a dictation window only once tagged (URL/load state never consulted)', () => {
  const pill = fakeWindow()
  assert.equal(isDictationWindow(pill), false)
  tagDictationWindow(pill)
  assert.equal(isDictationWindow(pill), true)
  // A freshly created, not-yet-loaded window (empty URL) is still recognised once tagged.
  const capture = fakeWindow()
  tagDictationWindow(capture)
  assert.equal(isDictationWindow(capture), true)
})

test('the quit check excludes the main window and every tagged dictation window', () => {
  const main = fakeWindow()
  const pill = fakeWindow()
  const capture = fakeWindow()
  tagDictationWindow(pill)
  tagDictationWindow(capture)
  // Only the main and the two Bark windows remain → the app may quit.
  assert.equal(onlyDictationWindowsRemain([main, pill, capture], main), true)
  // An untagged window (a real second app window) remains → do not quit.
  const other = fakeWindow()
  assert.equal(onlyDictationWindowsRemain([main, pill, other], main), false)
  // No windows at all → may quit.
  assert.equal(onlyDictationWindowsRemain([], main), true)
})
