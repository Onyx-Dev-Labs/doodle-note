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
      x: -1158,
      y: 889,
      width: 396,
      height: 120
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
  it('keeps Windows top-right placement with the same branded card as macOS', () => {
    assert.deepEqual(panelBounds({ x: 0, y: 0, width: 1920, height: 1040 }, 'win32'), {
      x: 1508,
      y: 16,
      width: 396,
      height: 120
    })
    for (const dark of [false, true]) {
      const mac = decodeURIComponent(panelDataUrl(prompt, dark, 'darwin', 'data:logo'))
      const win = decodeURIComponent(panelDataUrl(prompt, dark, 'win32', 'data:logo'))
      // Identical card apart from the entrance edge (Windows sits at the top).
      assert.equal(win, mac.replace('translateY(28px)', 'translateY(-28px)'))
      assert.match(win, /Record now/)
      assert.match(win, /aria-label="Dismiss meeting prompt"/)
      assert.doesNotMatch(win, /Take notes/)
    }
  })
  it('pins the macOS card and bottom-center placement', () => {
    const mac = decodeURIComponent(panelDataUrl(prompt, false, 'darwin'))
    assert.match(mac, /translateY\(28px\)/)
    assert.doesNotMatch(mac, /translateY\(-28px\)/)
    assert.deepEqual(panelBounds({ x: 0, y: 0, width: 1920, height: 1040 }, 'darwin'), {
      x: 762,
      y: 904,
      width: 396,
      height: 120
    })
  })
  it('keeps the legacy card on other platforms', () => {
    const legacy = decodeURIComponent(panelDataUrl(prompt, false, 'linux'))
    assert.match(legacy, /Take notes/)
    assert.match(legacy, /Dismiss/)
    assert.deepEqual(panelBounds({ x: 0, y: 0, width: 1920, height: 1040 }, 'linux'), {
      x: 1564,
      y: 16,
      width: 340,
      height: 108
    })
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

it('both prompt surfaces label only usable calendar links Record & Join', () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const linked = decodeURIComponent(
      panelDataUrl({ ...prompt, joinUrl: 'https://meet.google.com/aaa-bbbb-ccc' }, false, platform)
    )
    assert.match(linked, />Record &amp; Join<\/a>/)
    assert.equal((linked.match(/href="doodle-panel:\/\/start"/g) ?? []).length, 1)
    for (const joinUrl of [undefined, 'javascript:alert(1)', 'file:///tmp/test']) {
      assert.doesNotMatch(
        decodeURIComponent(panelDataUrl({ ...prompt, joinUrl }, false, platform)),
        /Record &amp; Join/
      )
    }
    assert.doesNotMatch(
      decodeURIComponent(
        panelDataUrl(
          { ...prompt, adHoc: true, joinUrl: 'https://meet.google.com/aaa-bbbb-ccc' },
          false,
          platform
        )
      ),
      /Record &amp; Join/
    )
  }
})
