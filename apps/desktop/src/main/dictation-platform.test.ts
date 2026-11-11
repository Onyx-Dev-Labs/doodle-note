import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  BARK_COPY,
  HOLD_KEY_OPTIONS,
  barkCopy,
  barkPlatform,
  describeWindowsHelper,
  describeWindowsHooks,
  privacySettingsUrl
} from '../shared/dictation-platform'
import { HOLD_KEYS } from '../shared/dictation-helper-protocol'
import { describeMouseCaptureFailure } from '../shared/dictation-pill'

test('only Windows gets the Windows tables; macOS and anything unknown keep the macOS ones', () => {
  assert.equal(barkPlatform('win32'), 'win32')
  assert.equal(barkPlatform('darwin'), 'darwin')
  assert.equal(barkPlatform('linux'), 'darwin')
  assert.equal(barkPlatform(undefined), 'darwin')
  assert.equal(barkCopy(undefined), BARK_COPY.darwin)
})

test('macOS words are byte-for-byte what the app said before Windows support', () => {
  // Pinned: these are the literals that lived inline in DictationSettings.tsx and
  // dictation-service.ts. A change here changes the shipped macOS app.
  assert.deepEqual(BARK_COPY.darwin, {
    device: 'this Mac',
    unsupported: "Bark, DoodleNote's dictation, is available on macOS only for now.",
    intro:
      "Bark is DoodleNote's dictation. Press a shortcut in any app and speak. Speech is recognized on this Mac and the text is typed into the field you were using. Audio is never retained and never leaves this Mac.",
    microphoneOff:
      'Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone.',
    microphoneAsk: 'Choose Allow in the macOS dialog to let DoodleNote Dev use the microphone.',
    transformsNeedModel:
      'Transforms need a notes model on this Mac or your own provider. Set one up under Notes model.',
    helperBlocked: 'The Bark helper is missing from this build.',
    helperDamaged: 'The Bark helper is missing from this build.',
    permissionsDescription: 'Microphone, Accessibility, and Input Monitoring',
    permissionsIntro:
      'Allow asks macOS directly, which also lists DoodleNote Dev under Privacy & Security. Once you have answered, macOS will not ask again and the button opens System Settings instead.',
    holdNeedsPermission: 'Allow Input Monitoring first.',
    mouseNeedsPermission: 'Allow Input Monitoring first.',
    mouseCaptureDenied: 'Allow Input Monitoring for DoodleNote Dev first, then try again.',
    mouseButtonsNote:
      'Middle, back, forward and extra buttons only; left and right click are never used.',
    mouseSoftwareNote:
      'Mouse software such as Logitech Options+ can remap buttons before macOS sees them. If a button does nothing, set it to its default or generic action there.',
    swallowRefused:
      'On, but macOS did not allow it, so the app under the pointer still sees the button. Allow Accessibility and Input Monitoring for this app and try again.',
    latencyLabel: 'Last dictation (measured on this Mac)',
    settingsApp: 'System Settings'
  })
  assert.deepEqual(HOLD_KEY_OPTIONS.darwin, [
    { value: 'off', label: 'Off' },
    { value: 'rightOption', label: 'Right Option (⌥)' },
    { value: 'rightControl', label: 'Right Control (⌃)' },
    { value: 'rightCommand', label: 'Right Command (⌘)' },
    { value: 'fn', label: 'Fn / Globe' }
  ])
})

test('Windows offers Right Alt and Right Ctrl under the protocol key names, and no Fn', () => {
  assert.deepEqual(HOLD_KEY_OPTIONS.win32, [
    { value: 'off', label: 'Off' },
    { value: 'rightOption', label: 'Right Alt' },
    { value: 'rightControl', label: 'Right Ctrl' }
  ])
  for (const option of HOLD_KEY_OPTIONS.win32) assert.ok(HOLD_KEYS.includes(option.value))
})

test('Windows words never mention macOS, System Settings or a Mac', () => {
  for (const [key, value] of Object.entries(BARK_COPY.win32)) {
    assert.doesNotMatch(value, /macOS|System Settings|\bMac\b|Input Monitoring|Accessibility/, key)
    assert.doesNotMatch(value, /DoodleNote Dev/, key)
  }
  assert.equal(BARK_COPY.win32.device, 'this PC')
  assert.equal(BARK_COPY.win32.settingsApp, 'Windows Settings')
  // Every key the macOS table has, Windows has too.
  assert.deepEqual(Object.keys(BARK_COPY.win32).sort(), Object.keys(BARK_COPY.darwin).sort())
})

test('privacy buttons: the same macOS panes as before; Windows has a microphone page only', () => {
  assert.equal(
    privacySettingsUrl('darwin', 'microphone'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  )
  assert.equal(
    privacySettingsUrl('darwin', 'accessibility'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  )
  assert.equal(
    privacySettingsUrl('darwin', 'input-monitoring'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
  )
  assert.equal(privacySettingsUrl('win32', 'microphone'), 'ms-settings:privacy-microphone')
  assert.equal(privacySettingsUrl('win32', 'accessibility'), null)
  assert.equal(privacySettingsUrl('win32', 'input-monitoring'), null)
})

test('Windows helper and hook rows say what is going on', () => {
  assert.match(describeWindowsHelper('ready'), /starts with DoodleNote/)
  assert.doesNotMatch(describeWindowsHelper('ready', true), /digest only/)
  assert.match(
    describeWindowsHelper('ready', false),
    /checked by its digest only/,
    'unheld start shown'
  )
  // The retry rule as it is: a later start holds it again, after repeated failures only after a minute.
  assert.match(describeWindowsHelper('ready', false), /once a minute has passed/)
  assert.doesNotMatch(describeWindowsHelper('ready', false), /the next start holds it again/)
  assert.match(describeWindowsHelper('blocked'), /app control/)
  assert.match(describeWindowsHelper('unavailable'), /Missing/)
  assert.equal(describeWindowsHooks(null).label, 'Checking…')
  assert.equal(describeWindowsHooks(true).label, 'Working')
  assert.equal(describeWindowsHooks(true, true).label, 'Working')
  assert.equal(describeWindowsHooks(true, false).label, 'Reconnecting…')
  assert.equal(describeWindowsHooks(false).label, 'Blocked')
  assert.equal(
    describeWindowsHelper('damaged'),
    'The file on disk does not match this build. Reinstall DoodleNote.'
  )
})

test('the blocked helper copy is accurate for a signed helper too (app control, not "unsigned")', () => {
  assert.match(BARK_COPY.win32.helperBlocked, /app control policy/)
  assert.match(BARK_COPY.win32.helperBlocked, /signed build/)
  assert.doesNotMatch(BARK_COPY.win32.helperBlocked, /because it is not signed|in a few minutes/)
  assert.ok(BARK_COPY.win32.helperDamaged.length > 0)
})

test('mouse capture failures: macOS unchanged, Windows names its own buttons', () => {
  assert.equal(
    describeMouseCaptureFailure('primary-button'),
    'Left and right click cannot be used, because they are needed for everything else. Press the middle, back, forward or an extra button.'
  )
  assert.equal(
    describeMouseCaptureFailure('input-monitoring-denied'),
    'Allow Input Monitoring for DoodleNote Dev first, then try again.'
  )
  assert.match(
    describeMouseCaptureFailure('primary-button', 'win32'),
    /middle, back or forward button\.$/
  )
  assert.match(
    describeMouseCaptureFailure('input-monitoring-denied', 'win32'),
    /Windows did not let/
  )
  assert.equal(
    describeMouseCaptureFailure('timeout', 'win32'),
    describeMouseCaptureFailure('timeout')
  )
})

test('the gate: Bark is supported with the macOS sidecar on macOS and the Windows engine on Windows only', () => {
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(
    index,
    /engine:\s*process\.platform === 'darwin' && engine instanceof EngineProcess \? engine : \(winBark \?\? null\)/
  )
  assert.match(
    index,
    /const barkWindows = process\.platform === 'win32' && engine instanceof WinEngineHost/
  )
  // The Windows helper path; the macOS paths are unchanged.
  assert.match(index, /join\(process\.resourcesPath, 'engine', 'dictation-helper\.exe'\)/)
  assert.match(index, /return join\(process\.resourcesPath, 'engine', 'dictation-helper'\)/)
  assert.match(index, /'engine',\s*'\.build',\s*'release',\s*'dictation-helper'/)
  // Fixture playback is for unpackaged test runs only.
  assert.match(
    index,
    /testHooks: !app\.isPackaged && process\.env\.DOODLENOTE_BARK_TEST_HOOKS === '1'/
  )
})

test('Bark stays off by default on every platform', async () => {
  const { DEFAULT_DICTATION_SETTINGS } = await import('../shared/dictation-api')
  assert.equal(DEFAULT_DICTATION_SETTINGS.enabled, false)
})

test('the Windows package ships the helper and CI builds it with the inbox compiler', () => {
  const builder = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8')
  const win = /^win:\n((?:[ \t].*\n|\n)*)/m.exec(builder.replace(/\r\n/g, '\n'))?.[1] ?? ''
  assert.match(
    win,
    /from: \.\.\/\.\.\/engine\/\.build\/windows\/dictation-helper\.exe\s+to: engine\/dictation-helper\.exe/
  )
  const mac = /^mac:\n((?:[ \t].*\n|\n)*)/m.exec(builder.replace(/\r\n/g, '\n'))?.[1] ?? ''
  assert.doesNotMatch(mac, /dictation-helper\.exe/)
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.match(
    pkg.scripts['package:win'],
    /node scripts\/build-dictation-helper-win\.cjs && .*node scripts\/write-dictation-helper-manifest\.cjs && electron-vite build/
  )
  assert.doesNotMatch(pkg.scripts.package, /dictation-helper-win/)
  const script = readFileSync(
    new URL('../../scripts/build-dictation-helper-win.cjs', import.meta.url),
    'utf8'
  )
  assert.match(script, /Framework64', 'v4\.0\.30319'/)
  assert.match(script, /\/target:winexe/)
})
