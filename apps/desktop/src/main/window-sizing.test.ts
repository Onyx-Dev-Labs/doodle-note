import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fitIntoWorkArea, MAIN_WINDOW_SIZE, mainWindowBoundsFor } from './window-sizing'

const css = readFileSync(new URL('../renderer/src/assets/main.css', import.meta.url), 'utf8')

test('the main window supports a compact 800 by 560 layout', () => {
  assert.deepEqual(MAIN_WINDOW_SIZE, {
    defaultWidth: 1180,
    defaultHeight: 760,
    minWidth: 800,
    minHeight: 560
  })
  assert.ok(MAIN_WINDOW_SIZE.minWidth < MAIN_WINDOW_SIZE.defaultWidth)
  assert.ok(MAIN_WINDOW_SIZE.minHeight < MAIN_WINDOW_SIZE.defaultHeight)
})

test('the sidebar remains accessible when compact height needs scrolling', () => {
  const sidebar = css.match(/\.sidebar\s*\{([^}]*)\}/)
  assert.ok(sidebar, 'Missing .sidebar CSS rule')
  assert.match(sidebar[1], /\boverflow-y\s*:\s*auto\s*;/)
})

// Work areas (DIPs) of common Windows laptops at their recommended scaling,
// with a 40 DIP taskbar (48 px at 125%, 60 px at 150%, 80 px at 200%).
const areas = {
  '1920x1080 @100%': { x: 0, y: 0, width: 1920, height: 1040 },
  '1920x1080 @125%': { x: 0, y: 0, width: 1536, height: 824 },
  '1920x1080 @150%': { x: 0, y: 0, width: 1280, height: 680 },
  '1920x1080 @200%': { x: 0, y: 0, width: 960, height: 500 },
  '1366x768 @150%': { x: 0, y: 0, width: 911, height: 472 },
  '2560x1600 @200% (secondary, left)': { x: -1280, y: 0, width: 1280, height: 760 }
}

test('the main window opens fully inside the work area at every common scale', () => {
  for (const [name, area] of Object.entries(areas)) {
    const b = mainWindowBoundsFor(area)
    assert.ok(b.x >= area.x && b.x + b.width <= area.x + area.width, `${name}: horizontally inside`)
    assert.ok(b.y >= area.y && b.y + b.height <= area.y + area.height, `${name}: vertically inside`)
    assert.ok(b.minWidth <= b.width && b.minHeight <= b.height, `${name}: minimum fits`)
  }
  // Roomy displays keep the designed default and minimum.
  assert.deepEqual(mainWindowBoundsFor(areas['1920x1080 @100%']), {
    x: 370,
    y: 140,
    width: 1180,
    height: 760,
    minWidth: 800,
    minHeight: 560
  })
  // 200% on 1080p: smaller than the default and even the minimum height.
  const small = mainWindowBoundsFor(areas['1920x1080 @200%'])
  assert.deepEqual(
    [small.width, small.height, small.minWidth, small.minHeight],
    [960, 500, 800, 500]
  )
})

test('a window moved to a smaller-DIP display is fitted back inside its work area', () => {
  const area = areas['1920x1080 @200%']
  assert.deepEqual(fitIntoWorkArea({ x: 400, y: 200, width: 1180, height: 760 }, area), {
    x: 0,
    y: 0,
    width: 960,
    height: 500
  })
  // Fits already: left alone even when partly off screen (the person put it there).
  assert.equal(fitIntoWorkArea({ x: 700, y: 300, width: 800, height: 480 }, area), null)
  // Negative-coordinate secondary display.
  assert.deepEqual(
    fitIntoWorkArea(
      { x: -1500, y: 50, width: 1400, height: 700 },
      areas['2560x1600 @200% (secondary, left)']
    ),
    { x: -1280, y: 50, width: 1280, height: 700 }
  )
})

test('the Windows tray icons carry an image for every common notification-area scale', () => {
  // The shell draws tray icons at 16 px x the system scale: 16, 20, 24, 32 (100-200%),
  // 40 and 48 (250-300%); Windows picks the matching ICO entry instead of resampling.
  for (const name of ['dogWin.ico', 'dogWinRecording.ico']) {
    const ico = readFileSync(new URL(`../../resources/tray/${name}`, import.meta.url))
    assert.equal(ico.readUInt16LE(2), 1, `${name} is an icon file`)
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256)
    for (const size of [16, 20, 24, 32, 40, 48])
      assert.ok(sizes.includes(size), `${name} has ${size}px`)
  }
})
