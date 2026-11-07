import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  WINDOWS_TITLE_BAR_HEIGHT,
  hasThemedTitleBarOverlay,
  hidesToTrayOnClose,
  titleBarOverlayFor,
  windowChromeOptions
} from './window-chrome'

const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n'
)
const read = (path: string): string =>
  readFileSync(new URL(`../renderer/src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('macOS keeps the hidden-inset title bar and traffic-light position exactly', () => {
  for (const dark of [false, true]) {
    assert.deepEqual(windowChromeOptions('darwin', dark), {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 16 }
    })
  }
  assert.equal(hasThemedTitleBarOverlay('darwin'), false)
  // Linux development runs keep the previous options too.
  assert.deepEqual(windowChromeOptions('linux', false), windowChromeOptions('darwin', false))
})

test('Windows hides the title bar and themes the caption-button overlay', () => {
  assert.deepEqual(windowChromeOptions('win32', false), {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#26281f',
      height: WINDOWS_TITLE_BAR_HEIGHT
    }
  })
  assert.deepEqual(windowChromeOptions('win32', true), {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#f0eee2',
      height: WINDOWS_TITLE_BAR_HEIGHT
    }
  })
  assert.equal(hasThemedTitleBarOverlay('win32'), true)
  assert.notDeepEqual(titleBarOverlayFor(true), titleBarOverlayFor(false))
  // The renderer's fallback height matches the overlay.
  assert.match(
    read('assets/windows-chrome.css'),
    new RegExp(`env\\(titlebar-area-height, ${WINDOWS_TITLE_BAR_HEIGHT}px\\)`)
  )
})

test('the main window takes its chrome from the platform helper and recolors on theme changes', () => {
  assert.match(
    indexSource,
    /\.\.\.windowChromeOptions\(process\.platform, nativeTheme\.shouldUseDarkColors\)/
  )
  assert.doesNotMatch(indexSource, /titleBarStyle: 'hiddenInset'/)
  assert.match(
    indexSource,
    /if \(hasThemedTitleBarOverlay\(process\.platform\)\) nativeTheme\.on\('updated', applyTitleBarOverlay\)/
  )
  assert.match(
    indexSource,
    /function applyTitleBarOverlay\(\): void \{\n {2}if \(!hasThemedTitleBarOverlay\(process\.platform\)\) return/
  )
  assert.match(
    indexSource,
    /setTitleBarOverlay\(titleBarOverlayFor\(nativeTheme\.shouldUseDarkColors\)\)/
  )
})

test('close while recording hides to the tray on macOS (unchanged) and now on Windows', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    assert.equal(hidesToTrayOnClose(platform, true, false), true)
    assert.equal(hidesToTrayOnClose(platform, false, false), false)
    assert.equal(hidesToTrayOnClose(platform, true, true), false)
  }
  assert.equal(hidesToTrayOnClose('linux', true, false), false)
  assert.match(
    indexSource,
    /if \(hidesToTrayOnClose\(process\.platform, recording\.busy, quitting\)\) \{\n\s+event\.preventDefault\(\)\n\s+window\.hide\(\)\n\s+\/\/[^\n]*\n\s+if \(process\.platform === 'win32'\) recordingTray\?\.showBackgroundHint\(\)/
  )
})

test('every Windows chrome rule is scoped to html[data-platform=win32], so macOS CSS is untouched', () => {
  const css = read('assets/windows-chrome.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((match) =>
    match[1].split(',').map((selector) => selector.trim())
  )
  assert.ok(selectors.length > 10)
  for (const selector of selectors) {
    assert.ok(selector.startsWith("html[data-platform='win32']"), `unscoped selector: ${selector}`)
  }
  const main = read('main.tsx')
  assert.match(main, /import '\.\/assets\/windows-chrome\.css'/)
  // The attribute is set before the first render, from the preload's platform.
  assert.ok(
    main.indexOf('applyPlatformAttribute(document.documentElement, hostPlatform())') <
      main.indexOf('createRoot(')
  )
  assert.match(
    readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8'),
    /exposeInMainWorld\('appPlatform', process\.platform\)/
  )
})

test('Windows chrome keeps headers, notices and Settings clear of the caption buttons', () => {
  const css = read('assets/windows-chrome.css')
  for (const selector of ['.home-topbar', '.editor-topbar']) {
    assert.match(
      css,
      new RegExp(
        `html\\[data-platform='win32'\\] \\${selector} \\{[^}]*padding-right: calc\\(var\\(--win-caption-inset\\) \\+ 16px\\)`
      )
    )
  }
  assert.match(css, /\.chrome::before \{[^}]*-webkit-app-region: drag/)
  assert.match(css, /\.models\.settings-redesign::-webkit-scrollbar-track \{[^}]*margin-top/)
  assert.match(css, /\.meeting-banner \{[^}]*--win-caption-inset/)
  assert.match(css, /\.toast \{[^}]*--win-caption-inset/)
})
