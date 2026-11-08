/**
 * A statement-level reading of a TOML document, for editing one table of a
 * config file in place. Every statement of a TOML 1.0 document is recognised
 * (plus the TOML 1.1 relaxations a newer Codex may accept: newlines and a
 * trailing comma in inline tables, `\e` and `\xHH` escapes, times without
 * seconds), with full quote and escape handling in keys, table headers and
 * values, and reported with the lines it spans. A caller can then drop whole
 * statements and keep every other byte of the file as it was.
 *
 * Anything that cannot be read throws TomlUncertain. A caller must then leave
 * the file alone: guessing where a table ends is how an edit deletes a user's
 * unrelated settings.
 */

export class TomlUncertain extends Error {}

export type TomlValue =
  | { kind: 'string'; value: string }
  | { kind: 'inline'; entries: TomlEntry[] }
  | { kind: 'array' }
  | { kind: 'scalar' }

/** A key/value inside an inline table; `path` is relative to the table. */
export interface TomlEntry {
  path: string[]
  value: TomlValue
}

export interface TomlStatement {
  /** First and last line (inclusive), counting lines as `text.split('\n')` does. */
  start: number
  end: number
  /** `other`: a blank or comment-only line. */
  kind: 'header' | 'keyval' | 'other'
  /** Header: the table's key path. Key/value: the full path (table + key). */
  path: string[]
  /** Key/value: its value. */
  value: TomlValue | null
}

const ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  e: '\x1b',
  '"': '"',
  '\\': '\\'
}

const BARE_KEY = /[A-Za-z0-9_-]+/y

const SCALAR = new RegExp(
  [
    'true|false',
    '[+-]?(?:inf|nan)',
    '0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*',
    '0o[0-7](?:_?[0-7])*',
    '0b[01](?:_?[01])*',
    // Offset/local date-times and dates, then local times (TOML 1.1: seconds optional).
    '\\d{4}-\\d{2}-\\d{2}(?:[Tt ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:[Zz]|[+-]\\d{2}:\\d{2})?)?',
    '\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?',
    '[+-]?(?:0|[1-9](?:_?\\d)*)(?:\\.\\d(?:_?\\d)*)?(?:[eE][+-]?\\d(?:_?\\d)*)?'
  ]
    .map((p) => `(?:${p})`)
    .join('|'),
  'y'
)

/** What may follow a scalar value. */
const AFTER_SCALAR = new Set([' ', '\t', ',', ']', '}', '#', '\n', '\r', undefined])

class Reader {
  i = 0
  constructor(private readonly s: string) {}

  fail(what: string): never {
    throw new TomlUncertain(`${what} (offset ${this.i})`)
  }

  peek(offset = 0): string | undefined {
    return this.s[this.i + offset]
  }

  at(text: string): boolean {
    return this.s.startsWith(text, this.i)
  }

  done(): boolean {
    return this.i >= this.s.length
  }

  spaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.i++
  }

  newline(): boolean {
    if (this.peek() === '\n') this.i++
    else if (this.at('\r\n')) this.i += 2
    else return false
    return true
  }

  lineEnd(): boolean {
    return this.done() || this.peek() === '\n' || this.at('\r\n')
  }

  comment(): void {
    while (!this.lineEnd()) this.i++
  }

  /** Spaces, comments and newlines, as allowed inside arrays and inline tables. */
  blank(): void {
    for (;;) {
      this.spaces()
      if (this.peek() === '#') this.comment()
      else if (!this.newline()) return
    }
  }

  /** Trailing spaces and comment, then the end of the line (or file). */
  endOfStatement(): void {
    this.spaces()
    if (this.peek() === '#') this.comment()
    if (!this.done() && !this.newline()) this.fail('expected the end of the line')
  }

  key(): string[] {
    const parts: string[] = []
    for (;;) {
      this.spaces()
      if (this.at('"""') || this.at("'''")) this.fail('a multi-line string cannot be a key')
      if (this.peek() === '"') parts.push(this.basicString())
      else if (this.peek() === "'") parts.push(this.literalString())
      else {
        BARE_KEY.lastIndex = this.i
        const bare = BARE_KEY.exec(this.s)
        if (!bare) this.fail('expected a key')
        parts.push(bare[0])
        this.i += bare[0].length
      }
      this.spaces()
      if (this.peek() !== '.') return parts
      this.i++
    }
  }

  escape(): string {
    const e = this.peek(1)
    if (e !== undefined && Object.prototype.hasOwnProperty.call(ESCAPES, e)) {
      this.i += 2
      return ESCAPES[e]
    }
    const length = e === 'u' ? 4 : e === 'U' ? 8 : e === 'x' ? 2 : 0
    const digits = this.s.slice(this.i + 2, this.i + 2 + length)
    if (length === 0 || !/^[0-9A-Fa-f]+$/.test(digits) || digits.length !== length)
      this.fail('invalid escape')
    const code = parseInt(digits, 16)
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) this.fail('invalid escape')
    this.i += 2 + length
    return String.fromCodePoint(code)
  }

  basicString(): string {
    this.i++
    let out = ''
    for (;;) {
      const c = this.peek()
      if (c === undefined || c === '\n' || c === '\r') this.fail('unterminated string')
      if (c === '"') {
        this.i++
        return out
      }
      if (c === '\\') out += this.escape()
      else {
        out += c
        this.i++
      }
    }
  }

  literalString(): string {
    const start = this.i + 1
    let end = start
    while (end < this.s.length && this.s[end] !== "'") {
      if (this.s[end] === '\n' || this.s[end] === '\r') break
      end++
    }
    if (this.s[end] !== "'") this.fail('unterminated string')
    this.i = end + 1
    return this.s.slice(start, end)
  }

  /** A closing `"""` or `'''`, with up to two more quotes that belong to the string. */
  closeMultiline(quote: string): string | null {
    if (!this.at(quote.repeat(3))) return null
    let run = 3
    while (this.peek(run) === quote) run++
    if (run > 5) this.fail('too many quotes closing a multi-line string')
    this.i += run
    return quote.repeat(run - 3)
  }

  multilineBasic(): string {
    this.i += 3
    this.newline()
    let out = ''
    for (;;) {
      if (this.done()) this.fail('unterminated multi-line string')
      const close = this.closeMultiline('"')
      if (close !== null) return out + close
      if (this.peek() === '\\') {
        // A line-ending backslash trims the newline and the whitespace after it.
        let j = this.i + 1
        while (this.s[j] === ' ' || this.s[j] === '\t') j++
        if (this.s[j] === '\n' || this.s.startsWith('\r\n', j)) {
          this.i = j
          while (/[ \t\r\n]/.test(this.peek() ?? '')) this.i++
        } else out += this.escape()
        continue
      }
      out += this.peek()
      this.i++
    }
  }

  multilineLiteral(): string {
    this.i += 3
    this.newline()
    let out = ''
    for (;;) {
      if (this.done()) this.fail('unterminated multi-line string')
      const close = this.closeMultiline("'")
      if (close !== null) return out + close
      out += this.peek()
      this.i++
    }
  }

  value(): TomlValue {
    if (this.at('"""')) return { kind: 'string', value: this.multilineBasic() }
    if (this.at("'''")) return { kind: 'string', value: this.multilineLiteral() }
    const c = this.peek()
    if (c === '"') return { kind: 'string', value: this.basicString() }
    if (c === "'") return { kind: 'string', value: this.literalString() }
    if (c === '[') {
      this.array()
      return { kind: 'array' }
    }
    if (c === '{') return { kind: 'inline', entries: this.inlineTable() }
    SCALAR.lastIndex = this.i
    const scalar = SCALAR.exec(this.s)
    if (!scalar || scalar[0] === '') this.fail('expected a value')
    this.i += scalar[0].length
    if (!AFTER_SCALAR.has(this.peek())) this.fail('unexpected text after a value')
    return { kind: 'scalar' }
  }

  array(): void {
    this.i++
    for (;;) {
      this.blank()
      if (this.peek() === ']') break
      this.value()
      this.blank()
      if (this.peek() === ',') this.i++
      else if (this.peek() === ']') break
      else this.fail('expected , or ] in an array')
    }
    this.i++
  }

  inlineTable(): TomlEntry[] {
    this.i++
    const entries: TomlEntry[] = []
    for (;;) {
      this.blank()
      // Empty table, or (TOML 1.1) a trailing comma.
      if (this.peek() === '}') break
      const path = this.key()
      if (this.peek() !== '=') this.fail('expected = in an inline table')
      this.i++
      this.spaces()
      entries.push({ path, value: this.value() })
      this.blank()
      if (this.peek() === ',') this.i++
      else if (this.peek() === '}') break
      else this.fail('expected , or } in an inline table')
    }
    this.i++
    return entries
  }
}

/** Every statement of a TOML document, in order. Throws TomlUncertain. */
export function tomlStatements(text: string): TomlStatement[] {
  const lineStarts = [0]
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') lineStarts.push(k + 1)
  const lineOf = (pos: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const r = new Reader(text)
  if (text.startsWith('﻿')) r.i = 1
  const statements: TomlStatement[] = []
  let table: string[] = []
  while (!r.done()) {
    const start = lineOf(r.i)
    r.spaces()
    let kind: TomlStatement['kind'] = 'other'
    let path: string[] = []
    let value: TomlValue | null = null
    if (r.peek() === '[') {
      const array = r.peek(1) === '['
      r.i += array ? 2 : 1
      path = r.key()
      const close = array ? ']]' : ']'
      if (!r.at(close)) r.fail('expected ] after a table name')
      r.i += close.length
      kind = 'header'
      table = path
    } else if (!r.lineEnd() && r.peek() !== '#') {
      const key = r.key()
      if (r.peek() !== '=') r.fail('expected =')
      r.i++
      r.spaces()
      value = r.value()
      kind = 'keyval'
      path = [...table, ...key]
    }
    r.endOfStatement()
    statements.push({ start, end: lineOf(r.i - 1), kind, path, value })
  }
  return statements
}
