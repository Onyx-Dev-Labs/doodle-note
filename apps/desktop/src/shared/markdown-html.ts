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

type ParsedListItem = {
  body: string
  checked: boolean | null
  children: ParsedList[]
}

type ParsedList = {
  kind: ListKind
  items: ParsedListItem[]
}

type ParsedListLine = {
  indent: number
  kind: ListKind
  body: string
  checked: boolean | null
}

const LIST_LINE = /^([ \t]*)(?:[-*]\s+(?:\[([ xX])\]\s+)?(.*)|(\d+)\.\s+(.*))$/

function parseListLine(rawLine: string): ParsedListLine | null {
  const match = LIST_LINE.exec(rawLine.trimEnd())
  if (!match) return null

  const indent = (match[1] ?? '').replace(/\t/g, '  ').length
  if (match[4] !== undefined) {
    return { indent, kind: 'ol', body: match[5] ?? '', checked: null }
  }

  const taskState = match[2]
  return {
    indent,
    kind: taskState === undefined ? 'ul' : 'taskList',
    body: match[3] ?? '',
    checked: taskState === undefined ? null : taskState.toLowerCase() === 'x'
  }
}

function parseListRun(
  lines: string[],
  start: number,
  mode: MarkdownHtmlMode
): { lists: ParsedList[]; next: number } {
  const roots: ParsedList[] = []
  const stack: Array<{ indent: number; list: ParsedList; lastItem: ParsedListItem }> = []
  let next = start

  while (next < lines.length) {
    const token = parseListLine(lines[next]!)
    if (!token) break

    const kind = mode === 'display' && token.kind === 'taskList' ? 'ul' : token.kind
    while (stack.length > 0 && stack[stack.length - 1]!.indent > token.indent) stack.pop()

    const frame = stack[stack.length - 1]
    if (!frame || frame.indent !== token.indent || frame.list.kind !== kind) {
      if (frame?.indent === token.indent) stack.pop()
      const parent = stack[stack.length - 1]
      const list: ParsedList = { kind, items: [] }
      if (parent) parent.lastItem.children.push(list)
      else roots.push(list)

      const item: ParsedListItem = {
        body: token.body,
        checked: token.checked,
        children: []
      }
      list.items.push(item)
      stack.push({ indent: token.indent, list, lastItem: item })
    } else {
      const item: ParsedListItem = {
        body: token.body,
        checked: token.checked,
        children: []
      }
      frame.list.items.push(item)
      frame.lastItem = item
    }

    next += 1
  }

  return { lists: roots, next }
}

function renderList(list: ParsedList, mode: MarkdownHtmlMode): string {
  const openTag = list.kind === 'taskList' ? '<ul data-type="taskList">' : `<${list.kind}>`
  const closeTag = list.kind === 'taskList' ? '</ul>' : `</${list.kind}>`
  const out = [openTag]

  for (const item of list.items) {
    const body = inlineHtml(item.body)
    let opening: string
    if (mode === 'editor' && list.kind === 'taskList') {
      opening = `<li data-type="taskItem" data-checked="${item.checked ? 'true' : 'false'}"><p>${body}</p>`
    } else if (item.checked !== null) {
      opening = `<li class="task"><input type="checkbox" disabled${item.checked ? ' checked' : ''}> ${body}`
    } else {
      opening = `<li>${body}`
    }

    if (item.children.length === 0) {
      out.push(`${opening}</li>`)
      continue
    }

    out.push(opening)
    for (const child of item.children) out.push(renderList(child, mode))
    out.push('</li>')
  }

  out.push(closeTag)
  return out.join('\n')
}

/**
 * Minimal markdown renderer: #/##/### headings, bullets, checkboxes, ordered
 * lists, blockquotes, fences, hr, paragraphs. Input is escaped before any
 * tags are added, so the output is inert HTML.
 */
function renderMarkdownHtml(md: string, mode: MarkdownHtmlMode): string {
  const out: string[] = []
  let inCode = false
  const codeLines: string[] = []
  const lines = md.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!
    const line = rawLine.trimEnd()

    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines.length = 0
        inCode = false
      } else {
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
      out.push(`<img src="${image[2]}" alt="${escapeHtml(image[1] ?? '')}">`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      out.push(`<h${level}>${inlineHtml(heading[2]!)}</h${level}>`)
      continue
    }

    if (parseListLine(rawLine)) {
      const parsed = parseListRun(lines, index, mode)
      for (const list of parsed.lists) out.push(renderList(list, mode))
      index = parsed.next - 1
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      out.push(`<blockquote>${inlineHtml(quote[1]!)}</blockquote>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push('<hr>')
      continue
    }
    if (line.trim().length === 0) continue
    out.push(`<p>${inlineHtml(line)}</p>`)
  }

  if (inCode && codeLines.length > 0) {
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }
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
