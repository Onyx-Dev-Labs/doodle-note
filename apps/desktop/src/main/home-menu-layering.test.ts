import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync(new URL('../renderer/src/assets/main.css', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `Missing CSS rule for ${selector}`)
  return match[1]
}

test('older date groups do not trap row popovers in an opacity stacking context', () => {
  assert.doesNotMatch(css, /\.day-group\.older\s*\{[^}]*\bopacity\s*:/s)
})

test('the row owning an open action surface sits above surrounding rows', () => {
  assert.match(rule('.meeting-row.actions-open'), /\bz-index\s*:\s*[1-9]\d*\s*;/)
})
