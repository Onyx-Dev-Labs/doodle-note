import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { applyPlatformAttribute, hostPlatform, shortcutLabel } from './platform'
import { fileManagerName, supportsLibraryLocation } from '../../../shared/storage-api'

test('macOS shortcut labels keep their glyphs exactly', () => {
  assert.equal(shortcutLabel('K', ['mod'], 'darwin'), '⌘K')
  assert.equal(shortcutLabel('B', ['mod'], 'darwin'), '⌘B')
  assert.equal(shortcutLabel('I', ['mod'], 'darwin'), '⌘I')
  // Apple order: Control, Option, Shift, Command.
  assert.equal(shortcutLabel('Z', ['mod', 'shift', 'alt', 'ctrl'], 'darwin'), '⌃⌥⇧⌘Z')
  // Unknown or missing platforms keep the macOS presentation.
  assert.equal(shortcutLabel('K', ['mod'], undefined), '⌘K')
})

test('Windows and Linux shortcut labels spell out Ctrl, Alt and Shift', () => {
  for (const platform of ['win32', 'linux']) {
    assert.equal(shortcutLabel('K', ['mod'], platform), 'Ctrl+K')
    assert.equal(shortcutLabel('B', ['mod'], platform), 'Ctrl+B')
    assert.equal(shortcutLabel('Z', ['shift', 'mod'], platform), 'Ctrl+Shift+Z')
    assert.equal(shortcutLabel('N', ['alt', 'shift', 'mod'], platform), 'Ctrl+Alt+Shift+N')
    // "mod" is Ctrl there, so an explicit Ctrl is not repeated.
    assert.equal(shortcutLabel('K', ['mod', 'ctrl'], platform), 'Ctrl+K')
    assert.equal(shortcutLabel('Esc', [], platform), 'Esc')
  }
})

test('no renderer label hard-codes a macOS modifier glyph outside the helper', () => {
  const dir = new URL('../', import.meta.url)
  // Bark dictation keys name physical Mac keys and are macOS-only (separate work).
  const allowed = new Set(['DictationSettings.tsx'])
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.tsx'))) {
    if (allowed.has(name)) continue
    const source = readFileSync(new URL(name, dir), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    assert.doesNotMatch(source, /[⌘⌥⇧⌃]/, `${name} should use shortcutLabel()`)
  }
})

test('the platform attribute is set only when the preload provides one', () => {
  const root = { dataset: {} as Record<string, string | undefined> }
  applyPlatformAttribute(root, undefined)
  assert.deepEqual(root.dataset, {})
  applyPlatformAttribute(root, 'win32')
  assert.equal(root.dataset['platform'], 'win32')
  assert.equal(hostPlatform(), undefined, 'no window in unit tests')
})

test('library location is offered on macOS and Windows, with the right file manager', () => {
  assert.equal(supportsLibraryLocation('darwin'), true)
  assert.equal(supportsLibraryLocation('win32'), true)
  assert.equal(supportsLibraryLocation('linux'), false)
  assert.equal(supportsLibraryLocation(undefined), false)
  assert.equal(fileManagerName('darwin'), 'Finder')
  assert.equal(fileManagerName('win32'), 'File Explorer')
  const models = readFileSync(new URL('../ModelsView.tsx', import.meta.url), 'utf8')
  assert.match(models, /\{supportsLibraryLocation\(detect\?\.platform\) && <StorageSettings \/>\}/)
  const index = readFileSync(new URL('../../../main/index.ts', import.meta.url), 'utf8')
  assert.match(index, /const storage = supportsLibraryLocation\(process\.platform\)/)
  assert.doesNotMatch(index, /process\.platform === 'darwin' \? await prepareLibrary/)
})
