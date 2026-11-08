import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ClientConfigError,
  codexConfigHasServer,
  codexConfigServerCommand,
  codexConfigWithServer,
  codexConfigWithoutServer
} from './mcp-clients-logic'
import type { McpServerSpec } from '../shared/integrations-api'

/**
 * The Codex config corpus: every input with the exact text left after removing
 * our server (null: the edit is refused and the file left alone) and the command
 * we read from it. Each case is also checked against Python's tomllib (input
 * valid or not, expected output = input without mcp_servers.doodle-note).
 */
interface CorpusCase {
  name: string
  input: string
  expected: string | null
  command: string | null | { throws: true }
  valid: boolean
}

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/codex-toml-corpus.json', import.meta.url), 'utf8')
) as CorpusCase[]

const spec: McpServerSpec = {
  command: '/Applications/DoodleNote.app/Contents/MacOS/DoodleNote',
  args: ['/Applications/DoodleNote.app/Contents/Resources/mcp/cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

for (const c of corpus) {
  test(`codex corpus: ${c.name}`, () => {
    if (c.expected === null) {
      assert.throws(() => codexConfigWithoutServer(c.input, 'x'), ClientConfigError)
      assert.throws(() => codexConfigWithServer(c.input, spec, 'x'), ClientConfigError)
    } else {
      assert.equal(codexConfigWithoutServer(c.input, 'x'), c.expected)
      assert.equal(codexConfigHasServer(c.expected), false)
      // Connect keeps the same lines and appends one table of ours.
      const next = codexConfigWithServer(c.input, spec, 'x')
      assert.ok(next.startsWith(c.expected.replace(/\n+$/, '')))
      const kept = c.expected.replace(/\n+$/, '')
      assert.equal(codexConfigWithoutServer(next, 'x'), kept === '' ? '' : kept + '\n')
      assert.equal(codexConfigServerCommand(next, 'x'), spec.command)
    }
    if (typeof c.command === 'object' && c.command !== null)
      assert.throws(() => codexConfigServerCommand(c.input, 'x'), ClientConfigError)
    else assert.equal(codexConfigServerCommand(c.input, 'x'), c.command)
  })
}

test('codex corpus: the reported two-table file keeps the project table', () => {
  const raw =
    '[mcp_servers.doodle-note]\ncommand = "x"\n\n[projects."C:/work/[demo]"]\ntrust_level = "trusted"\n'
  assert.equal(
    codexConfigWithoutServer(raw),
    '[projects."C:/work/[demo]"]\ntrust_level = "trusted"\n'
  )
})

test('codex: a refused file names the problem and the path', () => {
  assert.throws(
    () => codexConfigWithoutServer('[mcp_servers.doodle-note]\nx = "\n', '/u/.codex/config.toml'),
    /\/u\/\.codex\/config\.toml could not be read as TOML .*left unchanged/
  )
  // The Connected badge still reads the exact header line of such a file.
  assert.equal(codexConfigHasServer('[mcp_servers.doodle-note]\nx = "\n'), true)
  assert.equal(codexConfigHasServer('[other]\nx = "\n'), false)
})

// ---------------------------------------------------------------------------
// The shapes the base code (win/bark 2b7d32f, macOS production) handled: our
// table as a plain table, its header on its own line, no subtables, no other
// definition of our server, no line inside it starting with `[`. For each, the
// new code must give byte-identical results. The base functions are copied
// verbatim below as the reference.

const BASE_HEADER = '[mcp_servers.doodle-note]'

function baseWithout(raw: string): string {
  const lines = raw.split('\n')
  const start = lines.findIndex((line) => line.trim() === BASE_HEADER)
  if (start === -1) return raw
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('[')) {
      end = i
      break
    }
  }
  let cut = start
  while (cut > 0 && lines[cut - 1].trim() === '') cut--
  const result = [...lines.slice(0, cut), ...lines.slice(end)].join('\n')
  return result === '' || result.endsWith('\n') ? result : result + '\n'
}

function baseHas(raw: string): boolean {
  return raw.split('\n').some((line) => line.trim() === BASE_HEADER)
}

function baseWith(raw: string | null, s: McpServerSpec): string {
  const base = raw === null ? '' : baseWithout(raw)
  const envPairs = Object.entries(s.env)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(', ')
  const block =
    `${BASE_HEADER}\n` +
    `command = ${JSON.stringify(s.command)}\n` +
    `args = [${s.args.map((a) => JSON.stringify(a)).join(', ')}]\n` +
    `env = { ${envPairs} }\n`
  const trimmed = base.replace(/\n+$/, '')
  return trimmed === '' ? block : `${trimmed}\n\n${block}`
}

const PREFIXES = [
  '',
  'model = "o3"\n',
  'model = "o3"\n\n',
  '# Codex settings\nmodel = "o3"\napproval_policy = "on-request"\n\n\n',
  '[projects."/Users/me/work"]\ntrust_level = "trusted"\n\n',
  '[mcp_servers.other]\ncommand = "npx"\nargs = ["-y", "@x/server"]\n'
]

const OUR_TABLES = [
  baseWith(null, spec),
  '[mcp_servers.doodle-note]\ncommand = "/old/DoodleNote"\nargs = ["/old/cli.js"]\nenv = { ELECTRON_RUN_AS_NODE = "1" }\n',
  '  [mcp_servers.doodle-note]  \ncommand = "/old/DoodleNote"\n# a note\n\nargs = []\n',
  '[mcp_servers.doodle-note]\ncommand = "/old/DoodleNote"\nargs = [\n  "/old/cli.js",\n  "--x",\n]\n',
  '[mcp_servers.doodle-note]\n'
]

const SUFFIXES = [
  '',
  '\n',
  '[mcp_servers.other]\ncommand = "npx"\n',
  '\n[profiles.fast]\nmodel = "o4-mini"\n',
  '\n\n# Projects\n[projects."/Users/me/work"]\ntrust_level = "trusted"\n',
  '[[profiles.list]]\nname = "a"\n'
]

test('codex: every base-supported shape gives byte-identical results to the base', () => {
  let compared = 0
  for (const prefix of PREFIXES)
    for (const ours of OUR_TABLES)
      for (const suffix of SUFFIXES)
        for (const crlf of [false, true])
          for (const finalNewline of [true, false]) {
            let raw = prefix + ours + suffix
            if (!finalNewline) raw = raw.replace(/\n+$/, '')
            if (crlf) raw = raw.replace(/\n/g, '\r\n')
            const label = JSON.stringify(raw)
            assert.equal(codexConfigWithoutServer(raw), baseWithout(raw), label)
            assert.equal(codexConfigHasServer(raw), baseHas(raw), label)
            assert.equal(codexConfigWithServer(raw, spec), baseWith(raw, spec), label)
            // And the same file without our table at all.
            const without = baseWithout(raw)
            assert.equal(codexConfigWithoutServer(without), without, label)
            assert.equal(codexConfigHasServer(without), false, label)
            assert.equal(codexConfigWithServer(without, spec), baseWith(without, spec), label)
            compared++
          }
  assert.equal(compared, PREFIXES.length * OUR_TABLES.length * SUFFIXES.length * 4)
  assert.equal(codexConfigWithServer(null, spec), baseWith(null, spec))
})
