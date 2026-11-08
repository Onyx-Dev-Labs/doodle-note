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
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  AgentAccessService,
  agentAccessRoots,
  readConfigFile,
  replaceConfigFile,
  replaceConfigFileBase
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
