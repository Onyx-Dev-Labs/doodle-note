import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { AgentAccessService, agentAccessRoots } from './agent-access-service'
import {
  codexConfigHasServer,
  codexConfigWithServer,
  codexConfigWithoutServer,
  jsonConfigHasServer,
  jsonConfigWithServer,
  jsonConfigWithoutServer
} from './mcp-clients-logic-base'
import { STRICT_CLIENT_CONFIGS } from './mcp-clients-logic'
import type { McpClientId, McpServerSpec } from '../shared/integrations-api'

/**
 * macOS keeps win/bark 9355b87's client-config behavior. The only difference
 * is the disclosed one: the write is a temporary file renamed over the config.
 * These tests pin that: the base code is there byte for byte, the base's own
 * tests pass against it, a darwin AgentAccessService gives the same bytes,
 * modes, errors and badges as the base service on every input below for
 * Connect, Disconnect and the status, and it never reaches the strict
 * (Windows) implementation or its TOML scanner.
 */

const sha256 = (text: string): string =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')
const source = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

test('darwin code: win/bark 9355b87 mcp-clients-logic.ts from line 17, byte for byte', () => {
  const text = source('./mcp-clients-logic-base.ts').replace(/\r\n/g, '\n')
  const begin = text.indexOf('\n', text.indexOf('// BEGIN win/bark 9355b87')) + 1
  const end = text.indexOf('// END win/bark 9355b87')
  assert.ok(begin > 0 && end > begin)
  // sha256 of `git show 9355b87:apps/desktop/src/main/mcp-clients-logic.ts | sed -n '17,$p'`
  assert.equal(
    sha256(text.slice(begin, end)),
    '86decc2e77fc196fdbe5d908c03c120b7b1ed26f273491914312e22cb7ca8501'
  )
})

test("darwin code: the base's own tests are vendored unchanged apart from the module path", () => {
  const lines = source('./mcp-clients-logic-base.test.ts').replace(/\r\n/g, '\n').split('\n')
  const body = lines
    .slice(3)
    .join('\n')
    .replace("} from './mcp-clients-logic-base'\n", "} from './mcp-clients-logic'\n")
  // sha256 of `git show 9355b87:apps/desktop/src/main/mcp-clients-logic.test.ts`
  assert.equal(sha256(body), '177357db11a414f0551f2b0da72b7fcbc4be062240eef2754810dcd5b9fedb81')
})

/** Every module a source file loads: `from '…'`, `import('…')`, `require('…')`. */
const importsOf = (text: string): string[] =>
  [...text.matchAll(/(?:\bfrom |\bimport\(|\brequire\()'([^']+)'/g)].map((m) => m[1])

test('darwin code: the base module cannot reach the strict implementation or the TOML scanner', () => {
  assert.deepEqual(importsOf(source('./mcp-clients-logic-base.ts')).sort(), [
    '../shared/integrations-api',
    './mcp-clients-common'
  ])
  assert.deepEqual(importsOf(source('./mcp-clients-common.ts')).sort(), [
    '../shared/integrations-api',
    './app-identity'
  ])
  assert.deepEqual(importsOf(source('./app-identity.ts')).sort(), [
    '../shared/app-identities.json',
    '../shared/dictation-api'
  ])
  // The service reaches the strict code only through STRICT_CLIENT_CONFIGS, which
  // the poisoning test below replaces, and never imports the scanner itself.
  const service = source('./agent-access-service.ts').replace(/\r\n/g, '\n')
  assert.match(service, /^import \{ STRICT_CLIENT_CONFIGS \} from '\.\/mcp-clients-logic'$/m)
  assert.equal(importsOf(service).filter((m) => m === './mcp-clients-logic').length, 1)
  assert.ok(!importsOf(service).includes('./toml-statements'))
})

// ---------------------------------------------------------------------------
// The base service (win/bark 9355b87 AgentAccessService: setClientConnected,
// clientStatus, tryRead), statement for statement, with its in-place write.

const spec: McpServerSpec = {
  command: '/Applications/DoodleNote.app/Contents/MacOS/DoodleNote',
  args: ['/Applications/DoodleNote.app/Contents/Resources/mcp/cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

type Dialect = 'json' | 'toml'
type Op = 'connect' | 'disconnect' | 'status'

function baseTryRead(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function baseSetClientConnected(configPath: string, dialect: Dialect, connected: boolean): void {
  const raw = baseTryRead(configPath)
  let next: string | null
  if (connected) {
    next =
      dialect === 'json'
        ? jsonConfigWithServer(raw, spec, configPath)
        : codexConfigWithServer(raw, spec)
  } else {
    next =
      raw === null
        ? null
        : dialect === 'json'
          ? jsonConfigWithoutServer(raw, configPath)
          : codexConfigWithoutServer(raw)
  }
  if (next !== null && next !== raw) {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, next)
  }
}

function baseConnected(configPath: string, dialect: Dialect): boolean {
  const raw = baseTryRead(configPath)
  return raw !== null && (dialect === 'json' ? jsonConfigHasServer(raw) : codexConfigHasServer(raw))
}

const CLIENTS: { id: McpClientId; dialect: Dialect; path: (home: string) => string }[] = [
  {
    id: 'claude-desktop',
    dialect: 'json',
    path: (home) =>
      join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  },
  { id: 'claude-code', dialect: 'json', path: (home) => join(home, '.claude.json') },
  { id: 'codex', dialect: 'toml', path: (home) => join(home, '.codex', 'config.toml') }
]

const darwinService = (home: string, platform: NodeJS.Platform = 'darwin'): AgentAccessService =>
  new AgentAccessService(
    () => join(home, 'meetings'),
    spec,
    agentAccessRoots({ platform, env: {}, home, sandbox: { home, identity: '' } })
  )

interface Outcome {
  error: string | null
  bytes: string | null
  mode: number | null
  connected: boolean
  leftovers: string[]
}

const posix = process.platform !== 'win32'

function outcome(path: string, run: () => boolean): Outcome {
  let error: string | null = null
  let connected = false
  try {
    connected = run()
  } catch (e) {
    error = (e as Error).message
  }
  const exists = existsSync(path) && statSync(path).isFile()
  return {
    error,
    bytes: exists ? readFileSync(path, 'latin1') : null,
    mode: exists && posix ? statSync(path).mode & 0o7777 : null,
    connected,
    leftovers: existsSync(dirname(path))
      ? readdirSync(dirname(path)).filter((f) => f.endsWith('.tmp'))
      : []
  }
}

/** Puts `input` (null: no file) at a client's path in a fresh home. */
function prepare(home: string, path: string, input: string | null, mode: number): void {
  mkdirSync(home, { recursive: true })
  rmSync(path, { recursive: true, force: true })
  if (input === null) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, input)
  if (posix) chmodSync(path, mode)
}

/**
 * Runs `op` on `input` through the base service in one home and the darwin
 * service in another and requires the same result: error message, file bytes,
 * permission bits, Connected badge, no temporary file left behind.
 */
function compare(
  homes: { base: string; darwin: string },
  client: (typeof CLIENTS)[number],
  input: string | null,
  op: Op,
  mode = 0o640
): void {
  const basePath = client.path(homes.base)
  const darwinPath = client.path(homes.darwin)
  prepare(homes.base, basePath, input, mode)
  prepare(homes.darwin, darwinPath, input, mode)
  const expected = outcome(basePath, () => {
    if (op !== 'status') baseSetClientConnected(basePath, client.dialect, op === 'connect')
    return baseConnected(basePath, client.dialect)
  })
  const actual = outcome(darwinPath, () => {
    const service = darwinService(homes.darwin)
    const status =
      op === 'status' ? service.status() : service.setClientConnected(client.id, op === 'connect')
    return status.clients.find((c) => c.id === client.id)!.connected
  })
  // Error messages name the file; compare them with the homes swapped.
  if (expected.error) expected.error = expected.error.split(homes.base).join(homes.darwin)
  assert.deepEqual(actual, expected, `${client.id} ${op} ${JSON.stringify(input)}`)
}

function withHomes(run: (homes: { base: string; darwin: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dn-darwin-'))
  try {
    run({ base: join(root, 'base'), darwin: join(root, 'darwin') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// The 720-file Codex matrix (mcp-clients-toml.test.ts), each with and without our table.
const PREFIXES = [
  '',
  'model = "o3"\n',
  'model = "o3"\n\n',
  '# Codex settings\nmodel = "o3"\napproval_policy = "on-request"\n\n\n',
  '[projects."/Users/me/work"]\ntrust_level = "trusted"\n\n',
  '[mcp_servers.other]\ncommand = "npx"\nargs = ["-y", "@x/server"]\n'
]
const OUR_TABLES = [
  codexConfigWithServer(null, spec),
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

function codexMatrix(): string[] {
  const files: string[] = []
  for (const prefix of PREFIXES)
    for (const ours of OUR_TABLES)
      for (const suffix of SUFFIXES)
        for (const crlf of [false, true])
          for (const finalNewline of [true, false]) {
            let raw = prefix + ours + suffix
            if (!finalNewline) raw = raw.replace(/\n+$/, '')
            if (crlf) raw = raw.replace(/\n/g, '\r\n')
            files.push(raw, codexConfigWithoutServer(raw))
          }
  return files
}

/**
 * Codex files the strict scanner refuses or reads differently: each is where
 * Windows and the base disagree, so macOS must give the base's answer.
 */
const CODEX_STRICT_DIFFERS = [
  '[mcp_servers.doodle-note]\ncommand = "a\\eb"\n',
  '[mcp_servers.doodle-note]\ncommand = "\\x41"\n',
  '[mcp_servers.doodle-note]\ncommand = "unterminated\n',
  'mcp_servers.doodle-note.command = "/old/DoodleNote"\n',
  '[mcp_servers]\ndoodle-note = { command = "/old/DoodleNote" }\n',
  'mcp_servers = { doodle-note = { command = "/old/DoodleNote" } }\n',
  '[mcp_servers.doodle-note]\ncommand = "x"\n\n[mcp_servers.doodle-note.env]\nFOO = "bar"\n',
  '[mcp_servers.doodle-note]\ncommand = "x"\nargs = [\n["nested"],\n]\nkept = 1\n',
  '[projects."/Users/me/[demo]"]\ntrust_level = "trusted"\n',
  '\uFEFF[mcp_servers.doodle-note]\ncommand = "x"\n',
  '\uFEFFmodel = "o3"\n'
]

const EMPTYISH = ['', ' ', '\n', '\r\n', '  \n\n', '\t\n']

const JSON_INPUTS = [
  '{}',
  '{}\n',
  '{"mcpServers":{}}',
  JSON.stringify({ mcpServers: { 'doodle-note': { command: '/old' } } }),
  JSON.stringify({ mcpServers: { other: { command: 'npx' }, 'doodle-note': { command: '/old' } } }),
  JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'npx' } } }, null, 2) + '\n',
  jsonConfigWithServer(null, spec, 'x'),
  '{\n    "a": 1\n}',
  '\uFEFF{}',
  '\uFEFF' + JSON.stringify({ mcpServers: { 'doodle-note': { command: '/old' } } }),
  '{',
  '[]',
  'null',
  '"text"',
  '{"mcpServers": 5}',
  '{"mcpServers": null}'
]

const OPS: Op[] = ['connect', 'disconnect', 'status']

test('darwin: Codex matrix, all three operations, byte-identical to the base service', () => {
  withHomes((homes) => {
    const codex = CLIENTS[2]
    const files = codexMatrix()
    assert.equal(files.length, 720 * 2)
    let compared = 0
    for (const input of [...files, ...CODEX_STRICT_DIFFERS, ...EMPTYISH])
      for (const op of OPS) {
        compare(homes, codex, input, op)
        compared++
      }
    assert.equal(compared, (1440 + CODEX_STRICT_DIFFERS.length + EMPTYISH.length) * 3)
  })
})

test('darwin: JSON clients, all three operations, byte-identical to the base service', () => {
  withHomes((homes) => {
    for (const client of CLIENTS.slice(0, 2))
      for (const input of [...JSON_INPUTS, ...EMPTYISH])
        for (const op of OPS) compare(homes, client, input, op)
  })
})

test('darwin: no file, an unreadable file and the permission bits are as the base left them', () => {
  withHomes((homes) => {
    for (const client of CLIENTS) {
      // No file: Connect creates one with the default mode (0666 less the umask),
      // never 0600; Disconnect and the status leave it absent.
      for (const op of OPS) compare(homes, client, null, op)
      // An existing file's permission bits survive every rewrite.
      for (const mode of [0o600, 0o640, 0o644, 0o664, 0o755])
        for (const op of OPS)
          compare(homes, client, client.dialect === 'json' ? '{"a":1}' : 'model = "o3"\n', op, mode)
    }
    if (posix) {
      const umask = process.umask()
      const path = CLIENTS[2].path(homes.darwin)
      prepare(homes.darwin, path, null, 0)
      darwinService(homes.darwin).setClientConnected('codex', true)
      assert.equal(statSync(path).mode & 0o777, 0o666 & ~umask)
    }
  })
})

test("darwin: a folder in the config file's place fails as the base failed", () => {
  withHomes((homes) => {
    for (const client of CLIENTS)
      for (const op of OPS) {
        const basePath = client.path(homes.base)
        const darwinPath = client.path(homes.darwin)
        rmSync(homes.base, { recursive: true, force: true })
        rmSync(homes.darwin, { recursive: true, force: true })
        mkdirSync(basePath, { recursive: true })
        mkdirSync(darwinPath, { recursive: true })
        const run = (fn: () => void): string | null => {
          try {
            fn()
            return null
          } catch (e) {
            return (e as NodeJS.ErrnoException).code ?? (e as Error).message
          }
        }
        const expected = run(() => {
          if (op !== 'status') baseSetClientConnected(basePath, client.dialect, op === 'connect')
        })
        const actual = run(() => {
          const service = darwinService(homes.darwin)
          if (op === 'status') service.status()
          else service.setClientConnected(client.id, op === 'connect')
        })
        assert.equal(actual, expected, `${client.id} ${op}`)
        assert.ok(lstatSync(darwinPath).isDirectory())
      }
  })
})

test('darwin: a symbolic link is followed as writeFileSync followed it, dangling or not', (t) => {
  withHomes((homes) => {
    for (const dangling of [false, true]) {
      const results = (['base', 'darwin'] as const).map((side) => {
        const home = homes[side]
        rmSync(home, { recursive: true, force: true })
        mkdirSync(join(home, 'dotfiles'), { recursive: true })
        const target = join(home, 'dotfiles', 'claude.json')
        if (!dangling) writeFileSync(target, '{"a":1}')
        try {
          symlinkSync(target, join(home, '.claude.json'))
        } catch {
          return null // no symlink privilege (Windows without Developer Mode)
        }
        if (side === 'base') baseSetClientConnected(join(home, '.claude.json'), 'json', true)
        else darwinService(home).setClientConnected('claude-code', true)
        return {
          link: lstatSync(join(home, '.claude.json')).isSymbolicLink(),
          target: readFileSync(target, 'utf8')
        }
      })
      if (results[0] === null) {
        t.skip('symbolic links need a privilege on this machine')
        return
      }
      assert.deepEqual(results[1], results[0])
      assert.equal(results[1]?.link, true)
    }
  })
})

test('darwin: repointing (the Windows install move) is refused', () => {
  withHomes((homes) => {
    mkdirSync(homes.darwin, { recursive: true })
    assert.throws(() => darwinService(homes.darwin).repointStaleClients(() => true), /Windows-only/)
  })
})

/** Replaces every strict function with one that throws; returns the call count. */
function poisonStrict(t: TestContext): { calls: number } {
  const counter = { calls: 0 }
  for (const dialect of [STRICT_CLIENT_CONFIGS.json, STRICT_CLIENT_CONFIGS.codex])
    for (const name of ['withServer', 'withoutServer', 'hasServer', 'serverCommand'] as const)
      t.mock.method(dialect, name, () => {
        counter.calls++
        throw new Error(`the strict ${name} was reached`)
      })
  return counter
}

test('darwin never reaches the strict implementation (or its TOML scanner)', (t) => {
  const poisoned = poisonStrict(t)
  withHomes((homes) => {
    const inputs: Record<Dialect, (string | null)[]> = {
      toml: [null, ...CODEX_STRICT_DIFFERS, ...EMPTYISH, ...codexMatrix().slice(0, 40)],
      json: [null, ...JSON_INPUTS, ...EMPTYISH]
    }
    for (const client of CLIENTS)
      for (const input of inputs[client.dialect])
        for (const op of OPS) compare(homes, client, input, op)
  })
  assert.equal(poisoned.calls, 0)
  // The poison is live: a Windows service reaches it at once.
  withHomes((homes) => {
    const codexPath = join(homes.darwin, '.codex', 'config.toml')
    mkdirSync(dirname(codexPath), { recursive: true })
    writeFileSync(codexPath, 'model = "o3"\n')
    assert.throws(
      () => darwinService(homes.darwin, 'win32').status(),
      /strict hasServer was reached/
    )
    assert.throws(
      () => darwinService(homes.darwin, 'win32').setClientConnected('codex', true),
      /strict withServer was reached/
    )
  })
  assert.ok(poisoned.calls >= 2)
})
