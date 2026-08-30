import assert from 'node:assert/strict'
import { test } from 'node:test'
import { docToMarkdown } from '../renderer/src/lib/markdown'
import { markdownToEditorHtml, markdownToHtml } from '../shared/markdown-html'

test('display HTML keeps inert disabled checkboxes for export/Ask', () => {
  const html = markdownToHtml('- [x] Done item\n- [ ] Open item')
  assert.match(html, /<li class="task"><input type="checkbox" disabled checked>/)
  assert.match(html, /<li class="task"><input type="checkbox" disabled>/)
  assert.doesNotMatch(html, /data-type="taskList"/)
  assert.doesNotMatch(html, /data-type="taskItem"/)
})

test('editor HTML emits TipTap taskList / taskItem markers', () => {
  const html = markdownToEditorHtml('- [x] Done item\n- [ ] Open item')
  assert.match(html, /<ul data-type="taskList">/)
  assert.match(html, /<li data-type="taskItem" data-checked="true"><p>Done item<\/p><\/li>/)
  assert.match(html, /<li data-type="taskItem" data-checked="false"><p>Open item<\/p><\/li>/)
  assert.doesNotMatch(html, /class="task"/)
  assert.doesNotMatch(html, /disabled/)
})

test('editor HTML separates task lists from plain bullets', () => {
  const html = markdownToEditorHtml('- [ ] Task\n- Plain bullet\n1. Ordered')
  assert.match(html, /data-type="taskList"/)
  assert.match(html, /<\/ul>\n<ul>\n<li>Plain bullet<\/li>/)
  assert.match(html, /<ol>\n<li>Ordered<\/li>/)
})

test('editor HTML preserves nested task hierarchy', () => {
  const html = markdownToEditorHtml(
    '- [ ] create client in syncro\n  - [x] setup syncro policy\n- [ ] add huntress script'
  )

  assert.match(
    html,
    /<li data-type="taskItem" data-checked="false"><p>create client in syncro<\/p>\n<ul data-type="taskList">\n<li data-type="taskItem" data-checked="true"><p>setup syncro policy<\/p><\/li>\n<\/ul>\n<\/li>/
  )
  assert.match(
    html,
    /<\/li>\n<li data-type="taskItem" data-checked="false"><p>add huntress script<\/p><\/li>\n<\/ul>/
  )
})

test('docToMarkdown serializes TipTap taskList JSON to GFM checkboxes', () => {
  const md = docToMarkdown({
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done item' }] }]
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open item' }] }]
          }
        ]
      }
    ]
  })
  assert.equal(md, '- [x] Done item\n- [ ] Open item')
})

test('save → hydrate HTML cycle preserves checkbox markers for TipTap', () => {
  const saved = docToMarkdown({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Onboarding' }]
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'create client', marks: [{ type: 'bold' }] }]
              },
              {
                type: 'taskList',
                content: [
                  {
                    type: 'taskItem',
                    attrs: { checked: false },
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'setup syncro policy' }]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'add to CIPP' }] }]
          }
        ]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain note' }] }]
          }
        ]
      }
    ]
  })
  assert.match(saved, /- \[x\] \*\*create client\*\*/)
  assert.match(saved, / {2}- \[ \] setup syncro policy/)
  assert.match(saved, /- \[ \] add to CIPP/)
  assert.match(saved, /- plain note/)

  const hydrate = markdownToEditorHtml(saved)
  assert.match(hydrate, /data-type="taskList"/)
  assert.match(hydrate, /data-checked="true"/)
  assert.match(hydrate, /data-checked="false"/)
  assert.match(hydrate, /<strong>create client<\/strong>/)
  assert.match(
    hydrate,
    /<strong>create client<\/strong><\/p>\n<ul data-type="taskList">\n<li data-type="taskItem" data-checked="false"><p>setup syncro policy<\/p><\/li>\n<\/ul>\n<\/li>/
  )
  assert.match(hydrate, /<ul>\n<li>plain note<\/li>/)

  // Pre-fix display path would have dropped TipTap identity on reopen.
  const display = markdownToHtml(saved)
  assert.doesNotMatch(display, /data-type="taskItem"/)
})

test('editor HTML escapes untrusted markdown before tags', () => {
  const html = markdownToEditorHtml('- [ ] <SCRIPT>alert(1)</SCRIPT>')
  assert.match(html, /&lt;SCRIPT&gt;/)
  assert.doesNotMatch(html, /<script>/i)
})
