import type { JSONContent } from '@tiptap/react'

/**
 * TipTap JSON → markdown, by hand.
 *
 * Deliberately not the tiptap-markdown package: our schema is tiny
 * (paragraphs, headings, bullet/ordered/task lists, blockquote, code block,
 * hr + bold/italic/strike/code marks), and a ~100-line walker avoids a
 * dependency whose TipTap v3 support is unclear. Output feeds the merge
 * prompt, so plain readable markdown is all that's needed.
 */

function inlineNode(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'text') {
    let text = node.text ?? ''
    if (text.length === 0) return ''
    const marks = node.marks ?? []
    const has = (type: string): boolean => marks.some((m) => m.type === type)
    if (has('code')) return `\`${text}\``
    if (has('bold')) text = `**${text}**`
    if (has('italic')) text = `*${text}*`
    if (has('strike')) text = `~~${text}~~`
    return text
  }
  return inlineChildren(node)
}

function inlineChildren(node: JSONContent): string {
  return (node.content ?? []).map(inlineNode).join('')
}

function listToMarkdown(
  list: JSONContent,
  indent: string,
  markerFor: (item: JSONContent) => string
): string {
  const lines: string[] = []
  for (const item of list.content ?? []) {
    const marker = markerFor(item)
    const childIndent = indent + '  '
    let first = true
    for (const block of item.content ?? []) {
      if (first && block.type === 'paragraph') {
        lines.push(indent + marker + inlineChildren(block))
      } else {
        const rendered = blockToMarkdown(block, childIndent)
        if (rendered !== null) lines.push(rendered)
      }
      first = false
    }
    if (first) lines.push(indent + marker) // empty item
  }
  return lines.join('\n')
}

function blockToMarkdown(node: JSONContent, indent: string): string | null {
  switch (node.type) {
    case 'paragraph': {
      const text = inlineChildren(node)
      return text.trim().length > 0 ? indent + text : null
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.['level'] ?? 1), 1), 6)
      return indent + '#'.repeat(level) + ' ' + inlineChildren(node)
    }
    case 'bulletList':
      return listToMarkdown(node, indent, () => '- ')
    case 'orderedList': {
      let n = Number(node.attrs?.['start'] ?? 1)
      return listToMarkdown(node, indent, () => `${n++}. `)
    }
    case 'taskList':
      return listToMarkdown(node, indent, (item) => (item.attrs?.['checked'] ? '- [x] ' : '- [ ] '))
    case 'blockquote': {
      const inner = (node.content ?? [])
        .map((child) => blockToMarkdown(child, ''))
        .filter((s): s is string => s !== null)
        .join('\n\n')
      return inner
        .split('\n')
        .map((line) => indent + '> ' + line)
        .join('\n')
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : ''
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      return `${indent}\`\`\`${language}\n${code}\n${indent}\`\`\``
    }
    case 'horizontalRule':
      return indent + '---'
    case 'image': {
      const src = typeof node.attrs?.['src'] === 'string' ? node.attrs['src'] : ''
      if (!src) return null
      const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs['alt'] : ''
      return `${indent}![${alt.replace(/[[\]]/g, '')}](${src})`
    }
    default: {
      const text = inlineChildren(node)
      return text.trim().length > 0 ? indent + text : null
    }
  }
}

/** Serialize a TipTap document (editor.getJSON()) to markdown. */
export function docToMarkdown(doc: JSONContent | null | undefined): string {
  if (!doc?.content) return ''
  const parts: string[] = []
  for (const node of doc.content) {
    const rendered = blockToMarkdown(node, '')
    if (rendered !== null && rendered.trim().length > 0) parts.push(rendered)
  }
  return parts.join('\n\n').trim()
}

/* ---- tiny markdown → HTML for displaying enhanced notes ---- */

/**
 * Only local attachments render as images — the src whitelist keeps
 * javascript:/http: URLs (e.g. from a pasted markdown doc) inert.
 */

export { markdownToEditorHtml, markdownToHtml } from '../../../shared/markdown-html'
