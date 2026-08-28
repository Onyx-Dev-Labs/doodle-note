/**
 * Markdown → inert HTML, shared by the renderer (enhanced-notes panel) and
 * the main process (PDF export). Input is escaped before any tags are
 * added, so the output is safe to inject.
 *
 * Two outputs share the same parser:
 * - `markdownToHtml` — display/export HTML (disabled checkboxes, plain lists)
 * - `markdownToEditorHtml` — TipTap `setContent` hydrate HTML (`data-type`
 *   taskList / taskItem so to-dos survive reopen)
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const IMAGE_LINE = /^!\[([^\]]*)\]\((doodle-media:\/\/[a-z0-9.-]+)\)$/

function inlineHtml(s: string): string {
  let out = escapeHtml(s)
  // Links: http(s) only — anything else stays literal text.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return out
}

type ListKind = 'ul' | 'ol' | 'taskList'

type MarkdownHtmlMode = 'display' | 'editor'

/**
 * Minimal markdown renderer: #/##/### headings, bullets, checkboxes, ordered
 * lists, blockquotes, fences, hr, paragraphs. Input is escaped before any
 * tags are added, so the output is inert HTML.
 */
function renderMarkdownHtml(md: string, mode: MarkdownHtmlMode): string {
  const out: string[] = []
  let listKind: ListKind | null = null
  let inCode = false
  const codeLines: string[] = []

  const closeList = (): void => {
    if (listKind === 'taskList') {
      out.push('</ul>')
    } else if (listKind) {
      out.push(`</${listKind}>`)
    }
    listKind = null
  }
  const openList = (kind: ListKind): void => {
    if (listKind === kind) return
    closeList()
    if (kind === 'taskList') {
      out.push('<ul data-type="taskList">')
    } else {
      out.push(`<${kind}>`)
    }
    listKind = kind
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

    const image = IMAGE_LINE.exec(line.trim())
    if (image) {
      closeList()
      out.push(`<img src="${image[2]}" alt="${escapeHtml(image[1] ?? '')}">`)
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
      const checked = task[1]!.toLowerCase() === 'x'
      const body = inlineHtml(task[2]!)
      if (mode === 'editor') {
        openList('taskList')
        out.push(
          `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}"><p>${body}</p></li>`
        )
      } else {
        openList('ul')
        out.push(
          `<li class="task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${body}</li>`
        )
      }
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

/** Display/export HTML (Ask answers, PDF). Task lines use disabled checkboxes. */
export function markdownToHtml(md: string): string {
  return renderMarkdownHtml(md, 'display')
}

/**
 * TipTap editor hydrate HTML. Task lines become `ul[data-type=taskList]` /
 * `li[data-type=taskItem]` so reopen preserves interactive to-dos.
 */
export function markdownToEditorHtml(md: string): string {
  return renderMarkdownHtml(md, 'editor')
}
