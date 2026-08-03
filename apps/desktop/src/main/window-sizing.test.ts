import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MAIN_WINDOW_SIZE } from './window-sizing'

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
