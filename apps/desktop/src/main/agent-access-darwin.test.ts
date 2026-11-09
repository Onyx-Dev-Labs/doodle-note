import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  AgentAccessService,
  agentAccessRoots,
  readConfigFile,
  replaceConfigFile,
  replaceConfigFileBase,
  TEMPORARY_ATTEMPTS
} from './agent-access-service'
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
  mode = 0o640,
  folderMode: number | null = null
): void {
  const basePath = client.path(homes.base)
  const darwinPath = client.path(homes.darwin)
  prepare(homes.base, basePath, input, mode)
  prepare(homes.darwin, darwinPath, input, mode)
  // A read-only folder: made so after the file is in place, writable again
  // before anything else touches it.
  const lockFolders = (folder: number): void => {
    if (folderMode === null || !posix) return
    mkdirSync(dirname(basePath), { recursive: true })
    mkdirSync(dirname(darwinPath), { recursive: true })
    chmodSync(dirname(basePath), folder)
    chmodSync(dirname(darwinPath), folder)
  }
  lockFolders(folderMode ?? 0)
  const inode = (path: string): number | null => (existsSync(path) ? statSync(path).ino : null)
  const before = { base: inode(basePath), darwin: inode(darwinPath) }
  let expected: Outcome
  let actual: Outcome
  try {
    expected = outcome(basePath, () => {
      if (op !== 'status') baseSetClientConnected(basePath, client.dialect, op === 'connect')
      return baseConnected(basePath, client.dialect)
    })
    actual = outcome(darwinPath, () => {
      const service = darwinService(homes.darwin)
      const status =
        op === 'status' ? service.status() : service.setClientConnected(client.id, op === 'connect')
      return status.clients.find((c) => c.id === client.id)!.connected
    })
  } finally {
    lockFolders(0o755)
  }
  // Where the base could not have renamed (a read-only file or folder), the
  // darwin writer must not have either: the same file, written in place.
  if (posix && (folderMode !== null || (mode & 0o200) === 0) && before.darwin !== null)
    assert.equal(
      inode(darwinPath) === before.darwin,
      inode(basePath) === before.base,
      `${client.id} ${op} in place`
    )
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
      // Read-only ones (0444, 0400) fail Connect / Disconnect with the base's
      // EACCES (as non-root), never replaced by a rename.
      for (const mode of [0o600, 0o640, 0o644, 0o664, 0o755, 0o444, 0o400])
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

test('darwin: a read-only file or folder succeeds or fails exactly as the base wrote in place', (t) => {
  if (!posix) {
    t.skip('POSIX permission bits')
    return
  }
  // As root every write is allowed: both sides then succeed, still compared.
  if (process.getuid?.() === 0)
    t.diagnostic('running as root: permission bits do not refuse writes')
  withHomes((homes) => {
    let compared = 0
    for (const client of CLIENTS) {
      const unrelated = client.dialect === 'json' ? '{"a":1}' : 'model = "o3"\n'
      const ours =
        client.dialect === 'json'
          ? jsonConfigWithServer(null, spec, 'x')
          : codexConfigWithServer(null, spec)
      // A writable file in a read-only folder: the base wrote it in place (and
      // so does the darwin writer, same inode); a read-only file in a read-only
      // folder and a new file in a read-only folder fail as the base failed.
      for (const input of [unrelated, ours, null])
        for (const mode of [0o644, 0o600, 0o444, 0o400])
          for (const folderMode of [0o555, 0o500])
            for (const op of OPS) {
              if (input === null && mode !== 0o644) continue
              compare(homes, client, input, op, mode, folderMode)
              compared++
            }
      // A read-only file in a writable folder (the rename alone would succeed).
      for (const input of [unrelated, ours])
        for (const mode of [0o444, 0o400, 0o440, 0o555])
          for (const op of OPS) {
            compare(homes, client, input, op, mode)
            compared++
          }
    }
    t.diagnostic(`${compared} comparisons, umask ${process.umask().toString(8)}`)
  })
})

test('darwin writer: read-only targets are written in place, exactly as writeFileSync', (t) => {
  if (!posix) {
    t.skip('POSIX permission bits')
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'dn-darwin-ro-'))
  try {
    const cases: { name: string; file: number | null; folder: number }[] = [
      { name: 'read-only file 0444', file: 0o444, folder: 0o755 },
      { name: 'read-only file 0400', file: 0o400, folder: 0o755 },
      { name: 'writable file, read-only folder', file: 0o644, folder: 0o555 },
      { name: 'read-only file, read-only folder', file: 0o444, folder: 0o555 },
      { name: 'no file, read-only folder', file: null, folder: 0o555 },
      { name: 'writable file, writable folder (atomic)', file: 0o644, folder: 0o755 }
    ]
    for (const c of cases) {
      const results = (['base', 'darwin'] as const).map((side) => {
        const folder = join(root, c.name.replace(/\W+/g, '-'), side)
        mkdirSync(folder, { recursive: true })
        const path = join(folder, 'config.json')
        if (c.file !== null) {
          writeFileSync(path, '{"a":1}')
          chmodSync(path, c.file)
        }
        chmodSync(folder, c.folder)
        const ino = c.file === null ? null : statSync(path).ino
        let code: string | null = null
        try {
          if (side === 'base') writeFileSync(path, '{"b":2}')
          else replaceConfigFileBase(path, '{"b":2}')
        } catch (error) {
          code = (error as NodeJS.ErrnoException).code ?? 'unknown'
        }
        chmodSync(folder, 0o755)
        const exists = existsSync(path)
        return {
          code,
          bytes: exists ? readFileSync(path, 'utf8') : null,
          mode: exists ? statSync(path).mode & 0o7777 : null,
          inPlace: ino === null || !exists ? null : statSync(path).ino === ino,
          leftovers: readdirSync(folder).filter((f) => f !== 'config.json')
        }
      })
      const [base, darwin] = results
      t.diagnostic(
        `${c.name}: base ${base.code ?? 'written'}, darwin ${darwin.code ?? 'written'}` +
          (darwin.inPlace === null ? '' : darwin.inPlace ? ' in place' : ' renamed')
      )
      if (c.name.endsWith('(atomic)')) {
        assert.equal(darwin.inPlace, false, 'the writable case keeps the temporary file + rename')
        assert.deepEqual({ ...darwin, inPlace: true }, { ...base, inPlace: true }, c.name)
      } else assert.deepEqual(darwin, base, c.name)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** One side's result of a write: error code, bytes, mode, same inode, files left beside it. */
function writeResult(
  folder: string,
  path: string,
  ino: number | null,
  run: () => void
): {
  code: string | null
  bytes: string | null
  mode: number | null
  inPlace: boolean | null
  leftovers: string[]
} {
  let code: string | null = null
  try {
    run()
  } catch (error) {
    code = (error as NodeJS.ErrnoException).code ?? (error as Error).message
  }
  chmodSync(folder, 0o755)
  const exists = existsSync(path)
  return {
    code,
    bytes: exists ? readFileSync(path, 'utf8') : null,
    mode: exists ? statSync(path).mode & 0o7777 : null,
    inPlace: ino === null || !exists ? null : statSync(path).ino === ino,
    leftovers: readdirSync(folder).filter((f) => f.endsWith('.tmp'))
  }
}

test('round 11: a 220-character target name, directly or through a link, as the base', (t) => {
  if (!posix) {
    t.skip('POSIX file names and links')
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'dn-darwin-long-'))
  try {
    const long = `${'n'.repeat(215)}.json`
    assert.equal(long.length, 220)
    for (const via of ['direct', 'link'] as const)
      for (const exists of [true, false]) {
        const results = (['base', 'darwin'] as const).map((side) => {
          const folder = join(root, `${via}-${exists}`, side)
          mkdirSync(folder, { recursive: true })
          const file = join(folder, long)
          if (exists) {
            writeFileSync(file, '{"a":1}')
            chmodSync(file, 0o640)
          }
          const path = via === 'direct' ? file : join(folder, '.claude.json')
          if (via === 'link') symlinkSync(long, path)
          const ino = exists ? statSync(file).ino : null
          const result = writeResult(folder, file, ino, () => {
            if (side === 'base') writeFileSync(path, '{"b":2}')
            else replaceConfigFileBase(path, '{"b":2}')
          })
          if (via === 'link') assert.equal(readlinkSync(path), long, `${side}: still the link`)
          return result
        })
        const [base, darwin] = results
        t.diagnostic(
          `${via}, ${exists ? 'existing' : 'new'}: base ${base.code ?? 'written'}, darwin ${darwin.code ?? 'written'}`
        )
        assert.equal(darwin.code, null, 'no ENAMETOOLONG from the temporary name')
        // Written atomically (a new inode) where the base wrote in place; the rest equal.
        assert.deepEqual(
          { ...darwin, inPlace: null },
          { ...base, inPlace: null },
          `${via} ${exists}`
        )
      }
    // And through the services: ~/.claude.json linked to the long name.
    withHomes((homes) => {
      const client = CLIENTS.find((c) => c.id === 'claude-code')!
      for (const op of OPS) {
        const sides = (['base', 'darwin'] as const).map((side) => {
          const home = homes[side]
          rmSync(home, { recursive: true, force: true })
          mkdirSync(home, { recursive: true })
          writeFileSync(join(home, long), '{"a":1}')
          symlinkSync(long, client.path(home))
          return outcome(join(home, long), () => {
            if (side === 'base') {
              if (op !== 'status')
                baseSetClientConnected(client.path(home), client.dialect, op === 'connect')
              return baseConnected(client.path(home), client.dialect)
            }
            const service = darwinService(home)
            const status =
              op === 'status'
                ? service.status()
                : service.setClientConnected(client.id, op === 'connect')
            return status.clients.find((c) => c.id === client.id)!.connected
          })
        })
        assert.deepEqual(sides[1], sides[0], `claude-code ${op} through a long-named link`)
        assert.ok(lstatSync(client.path(homes.darwin)).isSymbolicLink())
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * Runs `run` with `hook` called before each of these fs functions (the writer's
 * calls go through the same module object; `realpathSync.native` as
 * `realpathSync.native`), so a change can be made at an exact point of the
 * write. A hook that throws stands for the call failing; one that returns a
 * function is given the call's result.
 */
const fsModule = createRequire(import.meta.url)('node:fs') as Record<string, unknown>
type FsHook = (name: string, args: unknown[]) => void | ((result: unknown) => void)
function withFsHook(hook: FsHook, run: () => void): void {
  const names = [
    'accessSync',
    'openSync',
    'closeSync',
    'statSync',
    'writeFileSync',
    'renameSync',
    'linkSync',
    'unlinkSync'
  ]
  const originals = names.map((name) => fsModule[name] as (...args: unknown[]) => unknown)
  const realpath = fsModule.realpathSync as { native: (...args: unknown[]) => unknown }
  const native = realpath.native
  const wrap =
    (name: string, original: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      const after = hook(name, args)
      const result = original(...args)
      if (typeof after === 'function') after(result)
      return result
    }
  names.forEach((name, i) => (fsModule[name] = wrap(name, originals[i])))
  realpath.native = wrap('realpathSync.native', native)
  syncBuiltinESMExports()
  try {
    run()
  } finally {
    names.forEach((name, i) => (fsModule[name] = originals[i]))
    realpath.native = native
    syncBuiltinESMExports()
  }
}

test('round 11: the concurrency contract, a change during the write against the base', (t) => {
  if (!posix || process.getuid?.() === 0) {
    t.skip('POSIX permission bits, as non-root')
    return
  }
  const root = mkdtempSync(join(tmpdir(), 'dn-darwin-race-'))
  const isTemp = (path: unknown): boolean => String(path).endsWith('.tmp')
  try {
    let n = 0
    const setup = (file: number | null): { folder: string; path: string; ino: number | null } => {
      const folder = join(root, String(n++))
      mkdirSync(folder)
      const path = join(folder, 'config.json')
      if (file !== null) {
        writeFileSync(path, '{"a":1}')
        chmodSync(path, file)
      }
      return { folder, path, ino: file === null ? null : statSync(path).ino }
    }
    // Each case: the change, where it lands in the darwin writer, and the base's
    // result with the same change at the same moment of its own write (before its
    // open, or after it).
    const once = (fire: () => void): (() => void) => {
      let fired = false
      return () => {
        if (!fired) {
          fired = true
          fire()
        }
      }
    }
    const cases: {
      name: string
      file: number | null
      at: (name: string, args: unknown[], path: string) => boolean
      change: (path: string, folder: string) => void
      /** The base's write: the change before its open (true) or after it (false). */
      before: boolean
      expect?: { mode?: number; leftovers?: number }
    }[] = [
      {
        // Astra C2: writable at the check, 0444 before the temporary file exists.
        // The darwin writer's open came first, as the base's open would have: written,
        // and the new 0444 is kept (round 10: replaced, and 0644 restored).
        name: 'chmod 0444 after the open, before the temporary file',
        file: 0o644,
        at: (name, args) => name === 'openSync' && isTemp(args[0]),
        change: (path) => chmodSync(path, 0o444),
        before: false
      },
      {
        name: 'chmod 0444 before the open (after the folder check)',
        file: 0o644,
        at: (name) => name === 'accessSync',
        change: (path) => chmodSync(path, 0o444),
        before: true
      },
      {
        // Another client's atomic rewrite meanwhile, to a read-only file: the name no
        // longer holds the opened file, so the base's write decides (EACCES).
        name: 'replaced by a read-only file after the open',
        file: 0o644,
        at: (name, args) => name === 'openSync' && isTemp(args[0]),
        change: (path) => {
          writeFileSync(`${path}.other`, '{"other":1}')
          chmodSync(`${path}.other`, 0o444)
          renameSync(`${path}.other`, path)
        },
        before: true
      },
      {
        name: 'the folder made read-only before the temporary file',
        file: 0o644,
        at: (name, args) => name === 'openSync' && isTemp(args[0]),
        change: (_path, folder) => chmodSync(folder, 0o555),
        before: false
      },
      {
        // A new file: one that appears meanwhile is never replaced (link(2)).
        name: 'no file; a read-only one appears before it is linked',
        file: null,
        at: (name) => name === 'linkSync',
        change: (path) => {
          writeFileSync(path, '{"other":1}')
          chmodSync(path, 0o444)
        },
        before: true
      },
      {
        // The residual: a change in the microseconds between the last fstat and the
        // rename lands on the replaced file. Pinned, so it cannot widen unseen.
        name: 'residual: chmod 0444 between the last fstat and the rename',
        file: 0o644,
        at: (name) => name === 'renameSync',
        change: (path) => chmodSync(path, 0o444),
        before: false,
        expect: { mode: 0o644 }
      },
      {
        // The residual: the folder made read-only between the temporary file and the
        // rename: the in-place write succeeds, the temporary file cannot be removed.
        name: 'residual: the folder made read-only before the rename',
        file: 0o644,
        at: (name) => name === 'renameSync',
        change: (_path, folder) => chmodSync(folder, 0o555),
        before: false,
        expect: { leftovers: 1 }
      },
      {
        // The same residual for a new file (round 12, Opus N1): the folder made
        // read-only before the link: EACCES, as the base's create would fail, and the
        // temporary file cannot be removed.
        name: 'residual: no file; the folder made read-only before the link',
        file: null,
        at: (name) => name === 'linkSync',
        change: (_path, folder) => chmodSync(folder, 0o555),
        before: true,
        expect: { leftovers: 1 }
      }
    ]
    for (const c of cases) {
      const base = setup(c.file)
      let baseResult: ReturnType<typeof writeResult>
      if (c.before) {
        c.change(base.path, base.folder)
        baseResult = writeResult(base.folder, base.path, base.ino, () =>
          writeFileSync(base.path, '{"b":2}')
        )
      } else
        baseResult = writeResult(base.folder, base.path, base.ino, () => {
          // The base's own write, opened before the change: open, change, write.
          const fd = openSync(base.path, 'w')
          try {
            c.change(base.path, base.folder)
            writeFileSync(fd, '{"b":2}')
          } finally {
            closeSync(fd)
          }
        })
      const darwin = setup(c.file)
      const fire = once(() => c.change(darwin.path, darwin.folder))
      let darwinResult!: ReturnType<typeof writeResult>
      withFsHook(
        (name, args) => {
          if (c.at(name, args, darwin.path)) fire()
        },
        () => {
          darwinResult = writeResult(darwin.folder, darwin.path, darwin.ino, () =>
            replaceConfigFileBase(darwin.path, '{"b":2}')
          )
        }
      )
      t.diagnostic(
        `${c.name}: base ${baseResult.code ?? 'written'} ${baseResult.mode?.toString(8)}, ` +
          `darwin ${darwinResult.code ?? 'written'} ${darwinResult.mode?.toString(8)}` +
          (darwinResult.leftovers.length ? `, ${darwinResult.leftovers.length} left` : '')
      )
      const expected = {
        ...baseResult,
        mode: c.expect?.mode ?? baseResult.mode,
        leftovers:
          darwinResult.leftovers.length === (c.expect?.leftovers ?? 0)
            ? darwinResult.leftovers
            : ['(none)'],
        inPlace: null
      }
      assert.deepEqual({ ...darwinResult, inPlace: null }, expected, c.name)
    }
  } finally {
    chmodSync(root, 0o755)
    rmSync(root, { recursive: true, force: true })
  }
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

// ---------------------------------------------------------------------------
// Symbolic link topologies. writeFileSync opens the path, so the kernel resolves
// every link and every `..` in order (a `..` after a folder link climbs from the
// link's target). The darwin writer must land on the same file in each case,
// and so must the Windows writer, which uses the same resolution.

interface Entry {
  kind: 'file' | 'dir' | 'link' | 'other'
  ino: number
  data: string
  mode: number | null
}

/** Every entry under `root`, links not followed: kind, inode, content or link text, mode. */
function snapshot(root: string): Map<string, Entry> {
  const entries = new Map<string, Entry>()
  const walk = (relative: string): void => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const rel = relative ? `${relative}/${name}` : name
      const full = join(root, rel)
      const stats = lstatSync(full)
      const kind = stats.isSymbolicLink()
        ? 'link'
        : stats.isDirectory()
          ? 'dir'
          : stats.isFile()
            ? 'file'
            : 'other'
      entries.set(rel, {
        kind,
        ino: stats.ino,
        data:
          kind === 'link'
            ? readlinkSync(full)
            : kind === 'file'
              ? readFileSync(full, 'latin1')
              : '',
        mode: kind === 'file' ? stats.mode & 0o7777 : null
      })
      if (kind === 'dir') walk(rel)
    }
  }
  walk('')
  return entries
}

/**
 * What a write changed: the entries whose content (or presence) changed, and,
 * for each that existed before, whether it is still the same inode (written in
 * place) or a new one (renamed over). Anything else that changed (kind, mode,
 * link text, inode without content) is reported as a stray change.
 */
function writeEffect(
  before: Map<string, Entry>,
  after: Map<string, Entry>
): {
  changed: Record<string, { data: string; mode: number | null; inode: 'same' | 'new' | 'created' }>
  stray: string[]
} {
  const changed: Record<
    string,
    { data: string; mode: number | null; inode: 'same' | 'new' | 'created' }
  > = {}
  const stray: string[] = []
  for (const [rel, now] of after) {
    const was = before.get(rel)
    if (!was) {
      if (now.kind === 'file') changed[rel] = { data: now.data, mode: now.mode, inode: 'created' }
      else stray.push(`${rel}: new ${now.kind}`)
    } else if (was.kind !== now.kind) stray.push(`${rel}: ${was.kind} -> ${now.kind}`)
    else if (now.kind === 'file' && (was.data !== now.data || was.ino !== now.ino))
      changed[rel] = { data: now.data, mode: now.mode, inode: was.ino === now.ino ? 'same' : 'new' }
    else if (was.data !== now.data || was.mode !== now.mode || was.ino !== now.ino)
      stray.push(`${rel}: changed`)
  }
  for (const rel of before.keys()) if (!after.has(rel)) stray.push(`${rel}: removed`)
  return { changed, stray }
}

interface LinkCase {
  name: string
  client: McpClientId
  /** Builds the tree under `root` (absolute link texts point inside it). */
  build: (root: string, link: (text: string, at: string) => void) => void
  /**
   * The file a write lands on, relative to root (null: the write fails), as the
   * POSIX kernel resolves it (macOS, Linux). Windows resolves `..` before links
   * (the Win32 path is normalised first), so there the writers must land where
   * writeFileSync lands, whatever that is.
   */
  lands: string | null
}

const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

const LINK_CASES: LinkCase[] = [
  {
    name: 'a link to a file',
    client: 'claude-code',
    build: (root, link) => {
      write(root, 'dotfiles/claude.json', '{"a":1}')
      link(join(root, 'dotfiles', 'claude.json'), 'home/.claude.json')
    },
    lands: 'dotfiles/claude.json'
  },
  {
    name: 'a dangling link',
    client: 'claude-code',
    build: (root, link) => {
      mkdirSync(join(root, 'dotfiles'), { recursive: true })
      link(join(root, 'dotfiles', 'claude.json'), 'home/.claude.json')
    },
    lands: 'dotfiles/claude.json'
  },
  {
    // The reported case: `..` after a folder link climbs from the link's target.
    name: '.. after a folder link (both candidates exist)',
    client: 'claude-code',
    build: (root, link) => {
      write(root, 'store/config.json', '{"store":1}')
      write(root, 'home/config.json', '{"home":1}')
      mkdirSync(join(root, 'store', 'nested'), { recursive: true })
      link('../store/nested', 'home/dirlink')
      link('dirlink/../config.json', 'home/.claude.json')
    },
    lands: 'store/config.json'
  },
  {
    name: '.. after a folder link, dangling (the lexical candidate exists)',
    client: 'claude-code',
    build: (root, link) => {
      write(root, 'home/config.json', '{"home":1}')
      mkdirSync(join(root, 'store', 'nested'), { recursive: true })
      link('../store/nested', 'home/dirlink')
      link('dirlink/../config.json', 'home/.claude.json')
    },
    lands: 'store/config.json'
  },
  {
    name: 'a dangling link into a linked folder',
    client: 'claude-code',
    build: (root, link) => {
      mkdirSync(join(root, 'store', 'nested'), { recursive: true })
      link('../store/nested', 'home/linkdir')
      link('linkdir/claude.json', 'home/.claude.json')
    },
    lands: 'store/nested/claude.json'
  },
  {
    name: 'a chain whose second link is relative inside a linked folder',
    client: 'claude-code',
    build: (root, link) => {
      write(root, 'store/b.json', '{"store":1}')
      write(root, 'home/b.json', '{"home":1}')
      mkdirSync(join(root, 'store', 'nested'), { recursive: true })
      link('../store/nested', 'home/dotfiles')
      link('../b.json', 'store/nested/a.json')
      link('dotfiles/a.json', 'home/.claude.json')
    },
    lands: 'store/b.json'
  },
  {
    name: 'the same chain, dangling at the end',
    client: 'claude-code',
    build: (root, link) => {
      write(root, 'home/b.json', '{"home":1}')
      mkdirSync(join(root, 'store', 'nested'), { recursive: true })
      link('../store/nested', 'home/dotfiles')
      link('../b.json', 'store/nested/a.json')
      link('dotfiles/a.json', 'home/.claude.json')
    },
    lands: 'store/b.json'
  },
  {
    name: 'two .. after a folder link',
    client: 'claude-code',
    build: (root, link) => {
      write(root, 'store/x.json', '{"store":1}')
      write(root, 'x.json', '{"root":1}')
      mkdirSync(join(root, 'store', 'nested', 'deeper'), { recursive: true })
      link('../store/nested/deeper', 'home/deep')
      link('deep/../../x.json', 'home/.claude.json')
    },
    lands: 'store/x.json'
  },
  {
    name: "Codex: the config's folder is a link, the config a relative link with ..",
    client: 'codex',
    build: (root, link) => {
      write(root, 'store/shared.toml', 'model = "store"\n')
      write(root, 'home/shared.toml', 'model = "home"\n')
      mkdirSync(join(root, 'store', 'codex'), { recursive: true })
      link('../store/codex', 'home/.codex')
      link('../shared.toml', 'store/codex/config.toml')
    },
    lands: 'store/shared.toml'
  },
  {
    name: "Codex: the config's folder is a link, no config yet",
    client: 'codex',
    build: (root, link) => {
      mkdirSync(join(root, 'store', 'codex'), { recursive: true })
      link('../store/codex', 'home/.codex')
    },
    lands: 'store/codex/config.toml'
  },
  {
    name: 'a dangling link into a missing folder',
    client: 'claude-code',
    build: (_root, link) => {
      link('nowhere/claude.json', 'home/.claude.json')
    },
    lands: null
  },
  {
    name: 'a dangling link through a dangling folder link',
    client: 'claude-code',
    build: (_root, link) => {
      link('../missing', 'home/gone')
      link('gone/claude.json', 'home/.claude.json')
    },
    lands: null
  },
  {
    name: 'a loop',
    client: 'claude-code',
    build: (_root, link) => {
      link('loop.json', 'home/.claude.json')
      link('.claude.json', 'home/loop.json')
    },
    lands: null
  },
  {
    name: 'a link to a folder',
    client: 'claude-code',
    build: (root, link) => {
      mkdirSync(join(root, 'store', 'folder'), { recursive: true })
      link('../store/folder', 'home/.claude.json')
    },
    lands: null
  }
]

/** Builds `c` under `root`; false when symbolic links cannot be made here. */
function buildCase(root: string, c: LinkCase): boolean {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'home'), { recursive: true })
  try {
    c.build(root, (text, at) => {
      mkdirSync(dirname(join(root, at)), { recursive: true })
      symlinkSync(text, join(root, at))
    })
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM')
      return false
    throw error
  }
}

const clientPath = (root: string, id: McpClientId): string =>
  CLIENTS.find((c) => c.id === id)!.path(join(root, 'home'))

/**
 * Runs `write` on a fresh copy of `c` and reports what it changed, plus its error
 * code (null: it succeeded).
 */
function effectOf(
  root: string,
  c: LinkCase,
  run: (path: string) => void
): {
  error: string | null
  changed: ReturnType<typeof writeEffect>['changed']
  stray: string[]
} | null {
  if (!buildCase(root, c)) return null
  const before = snapshot(root)
  let error: string | null = null
  try {
    run(clientPath(root, c.client))
  } catch (e) {
    error = (e as NodeJS.ErrnoException).code ?? (e as Error).message
  }
  return { error, ...writeEffect(before, snapshot(root)) }
}

const TEXT = '{"written":1}\n'

test('darwin: every link topology, the base writer and the darwin writer change the same file', (t) => {
  withHomes((homes) => {
    let checked = 0
    for (const c of LINK_CASES) {
      const label = `${c.name} (${c.client})`
      const base = effectOf(homes.base, c, (path) => writeFileSync(path, TEXT))
      if (base === null) {
        t.skip('symbolic links need a privilege on this machine')
        return
      }
      const darwin = effectOf(homes.darwin, c, (path) => replaceConfigFileBase(path, TEXT))!
      // The base: in place (the same inode), on the expected file, or the expected failure.
      assert.deepEqual(base.stray, [], label)
      if (posix && c.lands === null) {
        assert.ok(base.error !== null, label)
        assert.deepEqual(base.changed, {}, label)
      } else if (posix) {
        assert.equal(base.error, null, label)
        assert.deepEqual(Object.keys(base.changed), [c.lands], label)
      }
      for (const e of Object.values(base.changed)) assert.notEqual(e.inode, 'new', label)
      // The darwin writer: the same error, the same file with the same bytes and
      // mode; that file's inode replaced (renamed over) instead of written in place.
      assert.equal(darwin.error, base.error, label)
      assert.deepEqual(darwin.stray, [], label)
      const expected = Object.fromEntries(
        Object.entries(base.changed).map(([rel, e]) => [
          rel,
          { ...e, inode: e.inode === 'same' ? 'new' : e.inode }
        ])
      )
      assert.deepEqual(darwin.changed, expected, label)
      const [rel] = Object.keys(base.changed)
      t.diagnostic(
        rel === undefined
          ? `${label}: both fail with ${base.error}, nothing changed`
          : `${label}: both write ${rel} (base: inode ${base.changed[rel].inode}, darwin: ${darwin.changed[rel].inode}), nothing else changed`
      )
      checked++
    }
    assert.equal(checked, LINK_CASES.length)
  })
})

test('darwin: every link topology through the services, as the base service', (t) => {
  withHomes((homes) => {
    for (const c of LINK_CASES) {
      const label = `${c.name} (${c.client})`
      const dialect = CLIENTS.find((x) => x.id === c.client)!.dialect
      const base = effectOf(homes.base, c, (path) => baseSetClientConnected(path, dialect, true))
      if (base === null) {
        t.skip('symbolic links need a privilege on this machine')
        return
      }
      const darwin = effectOf(homes.darwin, c, () =>
        darwinService(join(homes.darwin, 'home')).setClientConnected(c.client, true)
      )!
      assert.equal(darwin.error, base.error, label)
      assert.deepEqual(darwin.stray, base.stray, label)
      assert.deepEqual(Object.keys(darwin.changed), Object.keys(base.changed), label)
      if (posix && c.lands !== null) assert.deepEqual(Object.keys(base.changed), [c.lands], label)
      for (const [rel, e] of Object.entries(base.changed)) {
        assert.equal(darwin.changed[rel].data, e.data, `${label}: ${rel}`)
        assert.equal(darwin.changed[rel].mode, e.mode, `${label}: ${rel}`)
        assert.equal(darwin.changed[rel].inode, e.inode === 'same' ? 'new' : e.inode, label)
      }
    }
  })
})

test('every link topology, the Windows writer lands where writeFileSync lands (or refuses)', (t) => {
  withHomes((homes) => {
    for (const c of LINK_CASES) {
      const label = `${c.name} (${c.client})`
      const base = effectOf(homes.base, c, (path) => writeFileSync(path, TEXT))
      if (base === null) {
        t.skip('symbolic links need a privilege on this machine')
        return
      }
      const strict = effectOf(homes.darwin, c, (path) => {
        const read = readConfigFile(path)
        if (read.state === 'error') throw new Error(read.message)
        if (!replaceConfigFile(path, read.state === 'read' ? read.raw : null, TEXT))
          throw new Error('changed meanwhile')
      })!
      assert.deepEqual(strict.stray, [], label)
      if (base.error !== null) {
        // Refused, nothing written.
        assert.ok(strict.error !== null, label)
        assert.deepEqual(strict.changed, {}, label)
      } else {
        const lands = Object.keys(base.changed)
        assert.equal(strict.error, null, label)
        assert.deepEqual(Object.keys(strict.changed), lands, label)
        assert.equal(strict.changed[lands[0]].data, TEXT, label)
      }
      if (posix)
        assert.equal(base.error === null ? Object.keys(base.changed)[0] : null, c.lands, label)
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

/** An fs error as Node raises it. */
const fsError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: injected`), { code })

const cryptoModule = createRequire(import.meta.url)('node:crypto') as Record<string, unknown>
/** Runs `run` with randomBytes answered by `bytes` (the n-th call, from 0); returns the call count. */
function withRandomBytes(bytes: (call: number) => number, run: () => void): number {
  const original = cryptoModule.randomBytes
  let calls = 0
  cryptoModule.randomBytes = (size: number) => Buffer.alloc(size, bytes(calls++))
  syncBuiltinESMExports()
  try {
    run()
  } finally {
    cryptoModule.randomBytes = original
    syncBuiltinESMExports()
  }
  return calls
}

const WRITERS = ['darwin', 'windows'] as const
type Writer = (typeof WRITERS)[number]
/** Writes '{"b":2}' with `writer`; the Windows writer expects `before` ('{"a":1}' or none). */
const writeWith = (writer: Writer, path: string, exists: boolean): void => {
  if (writer === 'darwin') replaceConfigFileBase(path, '{"b":2}')
  else assert.equal(replaceConfigFile(path, exists ? '{"a":1}' : null, '{"b":2}'), true)
}
/** The temporary files beside a config (the foreign one included). */
const temporaries = (folder: string): string[] =>
  readdirSync(folder)
    .filter((f) => f.endsWith('.tmp'))
    .sort()

test('round 12: a temporary name another writer holds is never removed, both writers', (t) => {
  // Astra NEW-1: `.dn-00000000.tmp` belongs to someone else; the name is drawn
  // again (TEMPORARY_ATTEMPTS names in all). Round 11's darwin writer removed it.
  const root = mkdtempSync(join(tmpdir(), 'dn-temp-collision-'))
  try {
    const foreign = '.dn-00000000.tmp'
    let n = 0
    for (const writer of WRITERS)
      for (const exists of [true, false])
        for (const taken of [1, TEMPORARY_ATTEMPTS]) {
          const label = `${writer}, ${exists ? 'existing' : 'new'} config, ${taken} taken`
          const folder = join(root, String(n++))
          mkdirSync(folder)
          const path = join(folder, 'config.json')
          if (exists) writeFileSync(path, '{"a":1}')
          writeFileSync(join(folder, foreign), 'another writer')
          const ino = exists ? statSync(path).ino : null
          let code: string | null = null
          const calls = withRandomBytes(
            (call) => (call < taken ? 0 : 0x11),
            () => {
              try {
                writeWith(writer, path, exists)
              } catch (error) {
                code = (error as NodeJS.ErrnoException).code ?? null
              }
            }
          )
          t.diagnostic(`${label}: ${calls} names, ${code ?? 'written'}`)
          assert.equal(calls, Math.min(taken + 1, TEMPORARY_ATTEMPTS), `${label}: names drawn`)
          // The foreign file is never touched, and nothing of ours is left.
          assert.equal(readFileSync(join(folder, foreign), 'utf8'), 'another writer', label)
          assert.deepEqual(temporaries(folder), [foreign], label)
          if (taken < TEMPORARY_ATTEMPTS) {
            assert.equal(code, null, label)
            assert.equal(readFileSync(path, 'utf8'), '{"b":2}', label)
            if (posix && ino !== null)
              assert.notEqual(statSync(path).ino, ino, `${label}: replaced`)
          } else if (writer === 'darwin') {
            // Every name taken: the base's in-place write decides (here: written).
            assert.equal(code, null, label)
            assert.equal(readFileSync(path, 'utf8'), '{"b":2}', label)
            if (posix && ino !== null) assert.equal(statSync(path).ino, ino, `${label}: in place`)
          } else {
            // Windows: EEXIST is reported, the config untouched.
            assert.equal(code, 'EEXIST', label)
            assert.equal(
              existsSync(path) ? readFileSync(path, 'utf8') : null,
              exists ? '{"a":1}' : null
            )
          }
        }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round 12: a failed exclusive create removes nothing, both writers', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dn-temp-create-'))
  try {
    let n = 0
    for (const writer of WRITERS)
      for (const code of ['EACCES', 'ENOSPC', 'EEXIST']) {
        const label = `${writer}, temporary file creation ${code}`
        const folder = join(root, String(n++))
        mkdirSync(folder)
        const path = join(folder, 'config.json')
        writeFileSync(path, '{"a":1}')
        const removed: string[] = []
        let thrown: string | null = null
        withFsHook(
          (name, args) => {
            const temp = String(args[0]).endsWith('.tmp')
            if (name === 'unlinkSync' && temp) removed.push(String(args[0]))
            if (name === 'openSync' && temp) throw fsError(code)
          },
          () => {
            try {
              writeWith(writer, path, true)
            } catch (error) {
              thrown = (error as NodeJS.ErrnoException).code ?? null
            }
          }
        )
        t.diagnostic(`${label}: ${thrown ?? 'written'}, ${removed.length} removals`)
        assert.deepEqual(removed, [], `${label}: no removal`)
        assert.deepEqual(temporaries(folder), [], label)
        // darwin: a permission failure or every name taken -> the base's write; a full
        // disk is thrown with the config intact. Windows: every failure is thrown.
        const baseDecides = writer === 'darwin' && code !== 'ENOSPC'
        assert.equal(thrown, baseDecides ? null : code, label)
        assert.equal(readFileSync(path, 'utf8'), baseDecides ? '{"b":2}' : '{"a":1}', label)
      }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round 12: a full disk or an I/O error is thrown with the config intact, both writers', (t) => {
  // Opus S2: the base's in-place write truncates first; after ENOSPC the config
  // would be empty or cut short. Only permission and compatibility failures fall
  // back to it (BASE_DECIDES).
  const root = mkdtempSync(join(tmpdir(), 'dn-temp-enospc-'))
  try {
    let n = 0
    for (const writer of WRITERS)
      for (const exists of [true, false])
        for (const code of ['ENOSPC', 'EDQUOT', 'EIO']) {
          const label = `${writer}, ${exists ? 'existing' : 'new'} config, ${code} on the temporary write`
          const folder = join(root, String(n++))
          mkdirSync(folder)
          const path = join(folder, 'config.json')
          if (exists) writeFileSync(path, '{"a":1}')
          const ino = exists ? statSync(path).ino : null
          let thrown: string | null = null
          let inPlace = 0
          withFsHook(
            (name, args) => {
              // The temporary file's write goes through its descriptor.
              if (name === 'writeFileSync' && typeof args[0] === 'number') throw fsError(code)
              if (name === 'writeFileSync') inPlace++
            },
            () => {
              try {
                writeWith(writer, path, exists)
              } catch (error) {
                thrown = (error as NodeJS.ErrnoException).code ?? null
              }
            }
          )
          t.diagnostic(`${label}: ${thrown ?? 'written'}`)
          assert.equal(thrown, code, `${label}: surfaced`)
          assert.equal(inPlace, 0, `${label}: no in-place write`)
          assert.equal(
            existsSync(path) ? readFileSync(path, 'utf8') : null,
            exists ? '{"a":1}' : null
          )
          if (posix && ino !== null) assert.equal(statSync(path).ino, ino, `${label}: same file`)
          assert.deepEqual(temporaries(folder), [], `${label}: temporary file removed`)
        }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round 12: a temporary file whose removal fails remains; the result stands', (t) => {
  // The disclosed rule: the temporary file remains whenever its removal fails
  // (here an injected EPERM in a writable folder), and that failure is not reported.
  const root = mkdtempSync(join(tmpdir(), 'dn-temp-unlink-'))
  try {
    let n = 0
    for (const writer of WRITERS) {
      const folder = join(root, String(n++))
      mkdirSync(folder)
      const path = join(folder, 'config.json')
      writeFileSync(path, '{"a":1}')
      let result: boolean | null = null
      withFsHook(
        (name, args) => {
          if (name === 'unlinkSync' && String(args[0]).endsWith('.tmp')) throw fsError('EPERM')
          // darwin: the rename refused (EXDEV) -> the base's write; Windows: the
          // config changed meanwhile (the caller's expected text is stale) -> false.
          if (name === 'renameSync') throw fsError('EXDEV')
        },
        () => {
          if (writer === 'darwin') replaceConfigFileBase(path, '{"b":2}')
          else result = replaceConfigFile(path, '{"stale":1}', '{"b":2}')
        }
      )
      const left = temporaries(folder)
      t.diagnostic(`${writer}: ${left.length} left (${left.join(', ')})`)
      assert.equal(left.length, 1, writer)
      assert.match(left[0], /^\.dn-[0-9a-f]{8}\.tmp$/)
      assert.equal(readFileSync(join(folder, left[0]), 'utf8'), '{"b":2}', writer)
      if (writer === 'darwin') assert.equal(readFileSync(path, 'utf8'), '{"b":2}')
      else {
        assert.equal(result, false)
        assert.equal(readFileSync(path, 'utf8'), '{"a":1}')
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Every check before the replace, as the darwin writer makes it (round 13), and for which configs. */
const CHECKS: {
  site: string
  at: (name: string, args: unknown[]) => boolean
  exists: boolean[]
}[] = [
  // configWriteTarget: the config's own path resolved; for a new one, its folder.
  { site: 'resolve', at: (name) => name === 'realpathSync.native', exists: [true, false] },
  {
    site: 'resolve folder',
    at: (name, args) => name === 'realpathSync.native' && !String(args[0]).endsWith('.json'),
    exists: [false]
  },
  { site: 'stat', at: (name) => name === 'statSync', exists: [true, false] },
  { site: 'folder access', at: (name) => name === 'accessSync', exists: [true, false] },
  // The authority: opened for writing, no create, no truncation.
  {
    site: 'open',
    at: (name, args) => name === 'openSync' && args[1] === fsConstants.O_WRONLY,
    exists: [true]
  }
]

test('round 13: a failed check before the replace: the base decides only for BASE_DECIDES', (t) => {
  // Astra P2 (round 9): an I/O error at the open or the access check fell back to
  // the in-place write (round 12 classified only the replace's own steps).
  const root = mkdtempSync(join(tmpdir(), 'dn-checks-'))
  try {
    let n = 0
    for (const check of CHECKS)
      for (const exists of check.exists)
        for (const code of ['EIO', 'ENOMEM', 'EMFILE', 'EACCES', 'EPERM', 'EROFS']) {
          const label = `${check.site}, ${exists ? 'existing' : 'new'} config, ${code}`
          const folder = join(root, String(n++))
          mkdirSync(folder)
          const path = join(folder, 'config.json')
          if (exists) writeFileSync(path, '{"a":1}')
          const ino = exists ? statSync(path).ino : null
          let fired = false
          let inPlace = 0
          let thrown: string | null = null
          withFsHook(
            (name, args) => {
              if (name === 'writeFileSync' && typeof args[0] !== 'number') inPlace++
              if (!fired && check.at(name, args)) {
                fired = true
                throw fsError(code)
              }
            },
            () => {
              try {
                replaceConfigFileBase(path, '{"b":2}')
              } catch (error) {
                thrown = (error as NodeJS.ErrnoException).code ?? null
              }
            }
          )
          t.diagnostic(`${label}: ${thrown ?? 'written'}, ${inPlace} in-place writes`)
          assert.ok(fired, `${label}: reached`)
          const files = readdirSync(folder).sort()
          if (['EACCES', 'EPERM', 'EROFS'].includes(code)) {
            // Permission: the base's write decides, in place (here: written).
            assert.equal(thrown, null, label)
            assert.equal(inPlace, 1, `${label}: in place`)
            assert.equal(readFileSync(path, 'utf8'), '{"b":2}', label)
            if (posix && ino !== null) assert.equal(statSync(path).ino, ino, `${label}: same file`)
            assert.deepEqual(files, ['config.json'], label)
          } else {
            // Anything else: thrown, nothing written, nothing created.
            assert.equal(thrown, code, `${label}: surfaced`)
            assert.equal(inPlace, 0, `${label}: no in-place write`)
            assert.deepEqual(files, exists ? ['config.json'] : [], `${label}: nothing created`)
            if (exists) assert.equal(readFileSync(path, 'utf8'), '{"a":1}', label)
            if (posix && ino !== null) assert.equal(statSync(path).ino, ino, `${label}: same file`)
          }
        }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round 13: after an I/O error at a check, the truncating in-place write is not reached', (t) => {
  // Astra's second case: the fallback's own write then failed too (here: the file
  // truncated, then EIO, as a write on a failing disk leaves it), and the config
  // was left empty.
  const root = mkdtempSync(join(tmpdir(), 'dn-checks-truncate-'))
  try {
    let n = 0
    for (const check of CHECKS.filter((c) => c.exists.includes(true))) {
      const label = `EIO at ${check.site}`
      const folder = join(root, String(n++))
      mkdirSync(folder)
      const path = join(folder, 'config.json')
      writeFileSync(path, '{"a":1}')
      let fired = false
      let inPlace = 0
      let thrown: string | null = null
      withFsHook(
        (name, args) => {
          if (name === 'writeFileSync' && typeof args[0] !== 'number') {
            inPlace++
            truncateSync(String(args[0]))
            throw fsError('EIO')
          }
          if (!fired && check.at(name, args)) {
            fired = true
            throw fsError('EIO')
          }
        },
        () => {
          try {
            replaceConfigFileBase(path, '{"b":2}')
          } catch (error) {
            thrown = (error as NodeJS.ErrnoException).code ?? null
          }
        }
      )
      const left = readFileSync(path, 'utf8')
      t.diagnostic(
        `${label}: ${thrown ?? 'written'}, ${inPlace} in-place writes, ${left.length} bytes left`
      )
      assert.equal(thrown, 'EIO', label)
      assert.equal(inPlace, 0, `${label}: the in-place write is not reached`)
      assert.equal(left, '{"a":1}', `${label}: the config intact`)
      assert.deepEqual(readdirSync(folder), ['config.json'], label)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round 13: a close that fails is not repeated; its error stands and nothing is left', (t) => {
  // Opus N1 / Astra P3: the authority's close ran before it was cleared, so a
  // close that failed (POSIX releases the number anyway) was repeated in the
  // cleanup: EBADF replaced the real error and the temporary file stayed.
  const realClose = fsModule.closeSync as (fd: number) => void
  const root = mkdtempSync(join(tmpdir(), 'dn-close-'))
  try {
    const cases: {
      name: string
      writer: Writer
      /** Which descriptor's close fails: the authority (darwin) or the temporary file's. */
      fd: 'authority' | 'temporary'
      /** A failure injected before it (the authority then closes in the cleanup). */
      before?: string
      expect: { thrown: string | null; text: string }
    }[] = [
      {
        name: 'the authority, before the rename',
        writer: 'darwin',
        fd: 'authority',
        expect: { thrown: 'EIO', text: '{"a":1}' }
      },
      {
        // The temporary write refused (EACCES): the base's write decides, after
        // the authority's close in the cleanup failed.
        name: 'the authority, in the cleanup after a refused temporary write',
        writer: 'darwin',
        fd: 'authority',
        before: 'EACCES',
        expect: { thrown: null, text: '{"b":2}' }
      },
      {
        name: 'the temporary file',
        writer: 'darwin',
        fd: 'temporary',
        expect: { thrown: 'EIO', text: '{"a":1}' }
      },
      {
        name: 'the temporary file',
        writer: 'windows',
        fd: 'temporary',
        expect: { thrown: 'EIO', text: '{"a":1}' }
      }
    ]
    let n = 0
    for (const c of cases) {
      const label = `${c.writer}: ${c.name}`
      const folder = join(root, String(n++))
      mkdirSync(folder)
      const path = join(folder, 'config.json')
      writeFileSync(path, '{"a":1}')
      const ino = statSync(path).ino
      let watched: number | null = null
      let closes = 0
      let failed = false
      let thrown: string | null = null
      withFsHook(
        (name, args) => {
          if (name === 'openSync') {
            const temp = String(args[0]).endsWith('.tmp')
            if (temp === (c.fd === 'temporary') && (temp || args[1] === fsConstants.O_WRONLY))
              return (fd) => (watched = fd as number)
          }
          if (name === 'writeFileSync' && typeof args[0] === 'number' && c.before)
            throw fsError(c.before)
          if (name === 'closeSync' && args[0] === watched) {
            closes++
            if (!failed) {
              // Closed for real, then reported failed (as close(2) may on POSIX).
              failed = true
              realClose(args[0] as number)
              throw fsError('EIO')
            }
          }
          return undefined
        },
        () => {
          try {
            writeWith(c.writer, path, true)
          } catch (error) {
            thrown = (error as NodeJS.ErrnoException).code ?? null
          }
        }
      )
      t.diagnostic(`${label}: ${thrown ?? 'written'}, ${closes} close(s) of that descriptor`)
      assert.ok(failed, `${label}: reached`)
      assert.equal(thrown, c.expect.thrown, `${label}: the error`)
      assert.equal(closes, 1, `${label}: closed once`)
      assert.equal(readFileSync(path, 'utf8'), c.expect.text, label)
      if (posix && c.expect.thrown !== null) assert.equal(statSync(path).ino, ino, label)
      assert.deepEqual(temporaries(folder), [], `${label}: no temporary file left`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round 14: one removal attempt; a file that took the temporary name survives', (t) => {
  // Astra round 10: the round-13 retry unlinked the same name again after a
  // sleep, so a file another process created under it in the interval (ours
  // moved aside) was deleted. One attempt: a refused removal leaves ours behind.
  const realRename = fsModule.renameSync as (from: string, to: string) => void
  const realWrite = fsModule.writeFileSync as (path: string, text: string, o: object) => void
  const root = mkdtempSync(join(tmpdir(), 'dn-temp-reuse-'))
  try {
    const cases: { writer: Writer; after: string }[] = [
      { writer: 'windows', after: 'a stale read' },
      { writer: 'windows', after: 'a failed rename' },
      { writer: 'darwin', after: 'a refused rename' }
    ]
    const outcomes: (() => void)[] = []
    let n = 0
    for (const c of cases) {
      const label = `${c.writer}, after ${c.after}`
      const folder = join(root, String(n++))
      mkdirSync(folder)
      const path = join(folder, 'config.json')
      const aside = join(folder, 'moved-aside')
      writeFileSync(path, '{"a":1}')
      let attempts = 0
      let result: boolean | string | null = null
      withFsHook(
        (name, args) => {
          if (name === 'unlinkSync' && String(args[0]).endsWith('.tmp')) {
            if (attempts++ === 0) {
              // Refused; meanwhile ours is moved aside and FOREIGN takes the name.
              realRename(String(args[0]), aside)
              realWrite(String(args[0]), 'FOREIGN', { flag: 'wx' })
              throw fsError('EPERM')
            }
          }
          // Windows: thrown (not a sharing refusal); darwin: the base's write.
          if (name === 'renameSync' && c.after !== 'a stale read') throw fsError('EXDEV')
        },
        () => {
          try {
            if (c.writer === 'darwin') replaceConfigFileBase(path, '{"b":2}')
            else
              result = replaceConfigFile(
                path,
                c.after === 'a stale read' ? '{"stale":1}' : '{"a":1}',
                '{"b":2}'
              )
          } catch (error) {
            result = (error as NodeJS.ErrnoException).code ?? null
          }
        }
      )
      const left = temporaries(folder)
      const foreign = left.length === 1 ? readFileSync(join(folder, left[0]), 'utf8') : null
      t.diagnostic(
        `${label}: ${attempts} removal attempt(s), foreign ${foreign ?? 'gone'}, ${result}`
      )
      outcomes.push(() => {
        assert.equal(attempts, 1, `${label}: one removal attempt`)
        assert.deepEqual([left.length, foreign], [1, 'FOREIGN'], `${label}: the foreign file`)
        assert.equal(readFileSync(aside, 'utf8'), '{"b":2}', `${label}: ours left behind`)
        // The write's own result stands.
        if (c.writer === 'darwin') assert.equal(readFileSync(path, 'utf8'), '{"b":2}', label)
        else {
          assert.equal(result, c.after === 'a stale read' ? false : 'EXDEV', label)
          assert.equal(readFileSync(path, 'utf8'), '{"a":1}', label)
        }
      })
    }
    // Asserted after every case has run, so each one's diagnostic is shown.
    for (const check of outcomes) check()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
