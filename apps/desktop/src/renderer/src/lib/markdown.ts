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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineHtml(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return out
}

/**
 * Minimal markdown renderer for the enhanced-notes panel: #/##/### headings,
 * bullets, checkboxes, ordered lists, blockquotes, fences, hr, paragraphs.
 * Input is escaped before any tags are added, so the output is inert HTML.
 */
export function markdownToHtml(md: string): string {
  const out: string[] = []
  let listTag: 'ul' | 'ol' | null = null
  let inCode = false
  const codeLines: string[] = []

  const closeList = (): void => {
    if (listTag) {
      out.push(`</${listTag}>`)
      listTag = null
    }
  }
  const openList = (tag: 'ul' | 'ol'): void => {
    if (listTag !== tag) {
      closeList()
      out.push(`<${tag}>`)
      listTag = tag
    }
  }

  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()

    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines.length = 0
        inCode = false
      } else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeLines.push(rawLine)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1]!.length
      out.push(`<h${level}>${inlineHtml(heading[2]!)}</h${level}>`)
      continue
    }
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      openList('ul')
      const checked = task[1]!.toLowerCase() === 'x'
      out.push(
        `<li class="task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${inlineHtml(task[2]!)}</li>`
      )
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      openList('ul')
      out.push(`<li>${inlineHtml(bullet[1]!)}</li>`)
      continue
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      openList('ol')
      out.push(`<li>${inlineHtml(ordered[1]!)}</li>`)
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      closeList()
      out.push(`<blockquote>${inlineHtml(quote[1]!)}</blockquote>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList()
      out.push('<hr>')
      continue
    }
    if (line.trim().length === 0) {
      closeList()
      continue
    }
    closeList()
    out.push(`<p>${inlineHtml(line)}</p>`)
  }

  if (inCode && codeLines.length > 0) {
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }
  closeList()
  return out.join('\n')
}
