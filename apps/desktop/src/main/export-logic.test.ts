import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MeetingRecord } from '@repo/meetings-store'
import { buildExportHtml, buildExportMarkdown } from './export-logic'

const record: MeetingRecord = {
  id: 'm1',
  title: 'Budget sync',
  createdAt: '2026-07-12T18:00:00.000Z',
  startedAt: '2026-07-12T18:00:00.000Z',
  rawNotesMarkdown: '- rough note',
  enhancedMarkdown: '## Decisions\n- Budget approved at **$250,000**',
  echoSuppressed: 1,
  segments: [
    { id: 's1', channel: 'mic', speaker: 'You', text: 'Hello there', startMs: 5000, endMs: 7000, confidence: 0.9 },
    { id: 's2', channel: 'system', speaker: 'Them', text: 'Hi!', startMs: 9000, endMs: 9500, confidence: 0.9 },
    { id: 's3', channel: 'mic', speaker: 'You', text: 'echo line', startMs: 9100, endMs: 9400, confidence: 0.9, echo: true }
  ]
}

test('markdown export: title, notes, timestamped transcript, no echo', () => {
  const md = buildExportMarkdown(record)
  assert.match(md, /^# Budget sync/)
  assert.match(md, /Budget approved at \*\*\$250,000\*\*/)
  assert.match(md, /\*\*\[0:00\] You:\*\* Hello there/)
  assert.match(md, /\*\*\[0:04\] Them:\*\* Hi!/)
  assert.doesNotMatch(md, /echo line/)
})

test('markdown export falls back to rough notes when no enhanced', () => {
  const md = buildExportMarkdown({ ...record, enhancedMarkdown: undefined })
  assert.match(md, /- rough note/)
})

test('html export escapes the title and renders the markdown', () => {
  const html = buildExportHtml({ ...record, title: 'A <b>sneaky</b> title' }, buildExportMarkdown(record))
  assert.match(html, /A &lt;b&gt;sneaky&lt;\/b&gt; title/)
  assert.match(html, /<h2>Decisions<\/h2>/)
  assert.match(html, /<strong>\$250,000<\/strong>/)
  assert.doesNotMatch(html, /<script/)
})
