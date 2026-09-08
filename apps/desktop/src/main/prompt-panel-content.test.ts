import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { panelBounds, panelDataUrl } from './prompt-panel-content'

const prompt = {
  action: 'prompt' as const,
  eventId: 'test',
  subject: 'Planning',
  startIso: '2026-09-08T12:00:00Z'
}
const html = (dark = false): string =>
  decodeURIComponent(panelDataUrl(prompt, dark, 'darwin').split(',')[1])

describe('prompt panel content and placement', () => {
  it('centers at the bottom of the cursor display work area, including negative coordinates', () => {
    assert.deepEqual(panelBounds({ x: -1920, y: 25, width: 1920, height: 1000 }, 'darwin'), {
      x: -1130,
      y: 901,
      width: 340,
      height: 108
    })
  })
  it('stays inside work areas narrowed by side/bottom Docks, scaling or small displays', () => {
    for (const area of [
      { x: 90, y: 25, width: 800, height: 600 },
      { x: 0, y: -900, width: 1280, height: 790 },
      { x: -200, y: 0, width: 300, height: 100 }
    ]) {
      for (const platform of ['darwin', 'win32'] as const) {
        const bounds = panelBounds(area, platform)
        assert.ok(bounds.x >= area.x && bounds.y >= area.y)
        assert.ok(bounds.x + bounds.width <= area.x + area.width)
        assert.ok(bounds.y + bounds.height <= area.y + area.height)
      }
    }
  })
  it('preserves Windows top-right placement and legacy actions', () => {
    assert.deepEqual(panelBounds({ x: 0, y: 0, width: 1920, height: 1040 }, 'win32'), {
      x: 1564,
      y: 16,
      width: 340,
      height: 108
    })
    const legacy = decodeURIComponent(panelDataUrl(prompt, false, 'win32'))
    assert.match(legacy, /Take notes/)
    assert.match(legacy, /Dismiss/)
  })
  it('escapes untrusted calendar titles in both visible text and attributes', () => {
    const source = decodeURIComponent(
      panelDataUrl({ ...prompt, subject: '<script>"&\'evil</script>' }, false, 'darwin')
    )
    assert.ok(!source.includes('<script>'))
    assert.match(source, /&lt;script&gt;&quot;&amp;&#39;evil&lt;\/script&gt;/)
    assert.match(source, /default-src 'none'/)
  })
  it('has exactly one start and dismiss action, decorative paws, visible focus and reduced motion', () => {
    for (const dark of [false, true]) {
      const source = html(dark)
      assert.equal((source.match(/href="doodle-panel:\/\/start"/g) ?? []).length, 1)
      assert.equal((source.match(/href="doodle-panel:\/\/dismiss"/g) ?? []).length, 1)
      assert.match(source, />Record now<\/a>/)
      assert.match(source, /aria-label="Dismiss meeting prompt"/)
      assert.match(source, /class="paw-walk" aria-hidden="true"/)
      assert.match(source, /:focus-visible/)
      assert.match(source, /prefers-reduced-motion: reduce/)
      assert.ok(!/Generating notes|Doodling your notes|Fetching the highlights/.test(source))
    }
  })
})
