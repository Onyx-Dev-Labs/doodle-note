#!/usr/bin/env node
// Packaged-content check for the Windows build: lists resources/app.asar and fails
// if app source, build scripts, docs, tests or sourcemaps were bundled into it, or
// if app.asar.unpacked carries native binaries for another OS or CPU (they cannot
// load, and cannot be Authenticode-signed), or if a native binary (.node, .dll,
// .exe) was packed inside app.asar itself for another OS or CPU, or if anything the
// Windows app needs at run time is missing: a runtime binary (speech engine and its
// ONNX runtime, Koffi, reflink, llama CPU and Vulkan), a resource outside the archive
// (Bark helper and its manifest, the MCP server, tray icons) or one of the app's own
// dependencies inside app.asar. For a win-unpacked folder it also computes the bundled
// dependency closure: every PE file's imports (dependencyClosure) must be Windows' or
// in the package beside it or the exe, ggml's run-time backends must be there
// (ggmlBackendProblems), and a ggml-base.dll treated as absent must be reported.
//
//   node scripts/test-windows-package.cjs <win-unpacked dir | app.asar> [--list out.txt]
//     [--same-files-as <other win-unpacked dir>]
//
// --same-files-as also requires exactly the same app.asar entries and exactly the
// same files under app.asar.unpacked as the other package (CI: the QA identity
// package against the production one), byte for byte: every asar entry is
// extracted with @electron/asar (the module electron-builder packed it with) and
// every unpacked file read, and their SHA-256 compared. Only the files in
// IDENTITY_DIFFERENCES may differ, and only in the way each entry allows.
// --negative-control (with --same-files-as) then changes one byte in one unpacked
// file and one byte of one asar entry of this package, checks that each is
// reported, and puts the byte back.
//
// Lists the asar from its header directly: the file starts with a Chromium pickle
// holding the JSON directory tree.
const fs = require('node:fs')
const path = require('node:path')

/** The asar's JSON directory tree, and where file contents start (`dataOffset`). */
function readAsar(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    fs.readSync(fd, sizeBuf, 0, 8, 0)
    // Pickle 1: [payload size = 4][header pickle size]
    const headerSize = sizeBuf.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerSize)
    fs.readSync(fd, headerBuf, 0, headerSize, 8)
    // Pickle 2: [payload size][string length][utf8 json]
    const jsonLength = headerBuf.readUInt32LE(4)
    const header = JSON.parse(headerBuf.subarray(8, 8 + jsonLength).toString('utf8'))
    return { header, dataOffset: 8 + headerSize }
  } finally {
    fs.closeSync(fd)
  }
}

function readAsarHeader(file) {
  return readAsar(file).header
}

/** Every file path in the archive, POSIX-separated, relative to its root. */
function listAsar(file) {
  const out = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, rel)
      else out.push(rel)
    }
  }
  walk(readAsarHeader(file), '')
  return out.sort()
}

// The app itself is only out/** plus package.json; everything else at the top
// level would be workspace source or tooling. Inside node_modules, third-party
// packages may legitimately ship their own maps and test helpers, so only the
// app's own tree is held to the no-tests/no-sourcemaps rule.
const ALLOWED_TOP_LEVEL = new Set(['out', 'node_modules', 'package.json'])
const FORBIDDEN_APP_FILE = [
  [/\.map$/, 'sourcemap'],
  [/(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/, 'test file'],
  [/(^|\/)__tests__\//, 'test file'],
  [/\.tsx?$/, 'TypeScript source']
]

function problemsFor(files) {
  const problems = []
  for (const file of files) {
    const top = file.split('/')[0]
    if (!ALLOWED_TOP_LEVEL.has(top)) {
      problems.push(`${file}: outside out/ and node_modules (source, scripts, docs or tooling)`)
      continue
    }
    if (top === 'node_modules') continue
    for (const [pattern, label] of FORBIDDEN_APP_FILE) {
      if (pattern.test(file)) problems.push(`${file}: ${label}`)
    }
  }
  return problems
}

const NATIVE_EXTENSIONS = ['.node', '.dll', '.exe']
const IMAGE_FILE_MACHINE_AMD64 = 0x8664

/**
 * 'x64', another PE machine as hex, or 'not-pe' (an ELF / Mach-O build for another
 * OS), for the file at `start` (`size` bytes) in `file`; the whole file by default.
 */
function peMachine(file, start = 0, size = Infinity) {
  const fd = fs.openSync(file, 'r')
  try {
    const read = (length, at) => {
      if (at + length > size) return null
      const buf = Buffer.alloc(length)
      return fs.readSync(fd, buf, 0, length, start + at) === length ? buf : null
    }
    const head = read(64, 0)
    if (!head || head.toString('latin1', 0, 2) !== 'MZ') return 'not-pe'
    const peOffset = head.readUInt32LE(0x3c)
    const pe = read(6, peOffset)
    if (!pe || pe.toString('latin1', 0, 4) !== 'PE\0\0') return 'not-pe'
    const machine = pe.readUInt16LE(4)
    return machine === IMAGE_FILE_MACHINE_AMD64 ? 'x64' : `0x${machine.toString(16)}`
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Native binaries packed inside app.asar itself (not unpacked), each with its
 * machine: [{ path, machine }]. Files marked `unpacked` live in app.asar.unpacked
 * and are checked there.
 */
function nativeBinariesInAsar(file) {
  const { header, dataOffset } = readAsar(file)
  const found = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, rel)
      else if (
        !child.unpacked &&
        NATIVE_EXTENSIONS.includes(path.extname(name).toLowerCase()) &&
        child.offset !== undefined
      ) {
        found.push({
          path: rel,
          machine: peMachine(file, dataOffset + Number(child.offset), Number(child.size))
        })
      }
    }
  }
  walk(header, '')
  return found
}

/**
 * Windows runtime binaries every package must carry unpacked: the speech engine
 * (sherpa-onnx's addon, its C API and the ONNX runtime it loads), Koffi (Windows
 * APIs), reflink (library copies) and llama (local refinement: the CPU addon
 * node-llama-cpp resolves from its own node_modules, the hoisted copy, and the
 * Vulkan build). A build whose node_modules collector missed pnpm's platform
 * packages lacks them (round 2: the QA package lost sherpa-onnx, Koffi, reflink
 * and llama Vulkan).
 */
const REQUIRED_UNPACKED = [
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node',
  'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
  'node_modules/@reflink/reflink-win32-x64-msvc/reflink.win32-x64-msvc.node',
  'node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx-c-api.dll',
  'node_modules/sherpa-onnx-win-x64/onnxruntime.dll',
  'node_modules/@node-llama-cpp/win-x64-vulkan/bins/win-x64-vulkan/llama-addon.node',
  'node_modules/node-llama-cpp/node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node'
]

/**
 * Files outside app.asar (extraResources) the Windows app needs: the Bark helper
 * and the manifest its integrity check reads, the MCP server the client configs
 * launch, and the tray icons.
 */
const REQUIRED_RESOURCES = [
  'engine/dictation-helper.exe',
  'engine/dictation-helper.manifest.json',
  'mcp/cli.js',
  'mcp/package.json',
  'tray/dogWin.ico',
  'tray/dogWinRecording.ico'
]

/** The required Windows binaries missing from app.asar.unpacked. */
function missingRequiredBinaries(unpackedDir) {
  return REQUIRED_UNPACKED.filter(
    (rel) => !fs.existsSync(path.join(unpackedDir, ...rel.split('/')))
  )
}

/** The required resources missing from `resourcesDir` (win-unpacked\resources). */
function missingRequiredResources(resourcesDir) {
  return REQUIRED_RESOURCES.filter(
    (rel) => !fs.existsSync(path.join(resourcesDir, ...rel.split('/')))
  )
}

/**
 * The app's own dependencies (`dependencies` of apps/desktop/package.json) that
 * have no top-level package in app.asar, for the archive's file list.
 */
function missingDependencies(files, dependencies) {
  const present = new Set(files)
  return Object.keys(dependencies ?? {})
    .sort()
    .filter((name) => !present.has(`node_modules/${name}/package.json`))
}

/**
 * The DLL names a PE file imports: its import table and its delay-load import
 * table (lower case, in table order). [] for a file that is not a PE image.
 */
function peImports(file) {
  const data = fs.readFileSync(file)
  if (data.length < 64 || data.toString('latin1', 0, 2) !== 'MZ') return []
  const pe = data.readUInt32LE(0x3c)
  if (pe + 24 > data.length || data.toString('latin1', pe, pe + 4) !== 'PE\0\0') return []
  const sections = data.readUInt16LE(pe + 6)
  const optionalSize = data.readUInt16LE(pe + 20)
  const optional = pe + 24
  const magic = data.readUInt16LE(optional)
  const plus = magic === 0x20b
  if (!plus && magic !== 0x10b) return []
  const imageBase = plus
    ? data.readBigUInt64LE(optional + 24)
    : BigInt(data.readUInt32LE(optional + 28))
  const directories = optional + (plus ? 112 : 96)
  const directoryCount = data.readUInt32LE(optional + (plus ? 108 : 92))
  const table = optional + optionalSize
  const toOffset = (rva) => {
    for (let i = 0; i < sections; i++) {
      const at = table + i * 40
      const virtualSize = data.readUInt32LE(at + 8)
      const virtualAddress = data.readUInt32LE(at + 12)
      const rawSize = data.readUInt32LE(at + 16)
      const rawPointer = data.readUInt32LE(at + 20)
      if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize))
        return rva - virtualAddress + rawPointer
    }
    return -1
  }
  const nameAt = (rva) => {
    const at = toOffset(rva)
    if (at < 0) return null
    const end = data.indexOf(0, at)
    return end < 0 ? null : data.toString('latin1', at, end).toLowerCase()
  }
  const names = []
  const directory = (index) =>
    index < directoryCount ? data.readUInt32LE(directories + index * 8) : 0
  // IMAGE_DIRECTORY_ENTRY_IMPORT: 20-byte descriptors, name RVA at +12, ended by a zero one.
  const imports = directory(1)
  if (imports) {
    for (let at = toOffset(imports); at >= 0 && at + 20 <= data.length; at += 20) {
      const nameRva = data.readUInt32LE(at + 12)
      if (!nameRva && !data.readUInt32LE(at)) break
      const name = nameAt(nameRva)
      if (name) names.push(name)
    }
  }
  // IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT: 32-byte descriptors, name at +4 (an RVA, or a
  // VA in the old format whose attributes lack bit 0).
  const delayed = directory(13)
  if (delayed) {
    for (let at = toOffset(delayed); at >= 0 && at + 32 <= data.length; at += 32) {
      const attributes = data.readUInt32LE(at)
      let nameRva = data.readUInt32LE(at + 4)
      if (!nameRva) break
      if (!(attributes & 1)) nameRva = Number(BigInt(nameRva) - imageBase)
      const name = nameAt(nameRva)
      if (name) names.push(name)
    }
  }
  return names
}

/**
 * DLLs that come from Windows, its drivers or the VC++ runtime, never from the
 * package. Only these may be missing from it: a DLL a bundled binary imports that
 * is not on this list must be in the package, beside the binary or the app's exe
 * (where the loader looks first), even if some copy happens to sit in System32 (a
 * stale System32 onnxruntime.dll is exactly what a missing bundled one would load).
 */
const SYSTEM_DLLS = new Set(
  [
    'advapi32',
    'bcrypt',
    'bcryptprimitives',
    'cfgmgr32',
    'comctl32',
    'comdlg32',
    'crypt32',
    'cryptui',
    'd2d1',
    'd3d11',
    'd3d12',
    'd3d9',
    'dbghelp',
    'dcomp',
    'dhcpcsvc',
    'dnsapi',
    'dwmapi',
    'dwrite',
    'dxgi',
    'dxva2',
    'gdi32',
    'gdiplus',
    'hid',
    'imm32',
    'iphlpapi',
    'kernel32',
    'mf',
    'mfplat',
    'mfreadwrite',
    'mmdevapi',
    'msdmo',
    'mscoree',
    'msimg32',
    'msvcrt',
    'ncrypt',
    'netapi32',
    'normaliz',
    'ntdll',
    'ole32',
    'oleacc',
    'oleaut32',
    'opengl32',
    'powrprof',
    'propsys',
    'psapi',
    'rpcrt4',
    'secur32',
    'setupapi',
    'shcore',
    'shell32',
    'shlwapi',
    'ucrtbase',
    'uiautomationcore',
    'urlmon',
    'user32',
    'userenv',
    'usp10',
    'uxtheme',
    'version',
    'winhttp',
    'wininet',
    'winmm',
    'wintrust',
    'tbs',
    'wldap32',
    'ws2_32',
    'wtsapi32',
    'xinput1_4',
    'mswsock',
    'credui',
    'esent',
    'wevtapi',
    'pdh',
    'avrt',
    'ksuser',
    'audioses',
    'mpr',
    'wlanapi',
    'ntmarta',
    'sspicli',
    'srvcli',
    'wkscli',
    'virtdisk',
    'fltlib',
    'winusb',
    'msi',
    'shdocvw',
    'devobj',
    'mfsensorgroup',
    // VC++ runtime (the redistributable Windows Update installs) and OpenMP.
    'vcruntime140',
    'vcruntime140_1',
    'msvcp140',
    'msvcp140_1',
    'msvcp140_2',
    'concrt140',
    'vcomp140',
    // GPU drivers: present only with the driver, loaded optionally by the GPU builds.
    'vulkan-1',
    'nvcuda',
    'opencl',
    'nvml'
  ]
    .map((name) => `${name}.dll`)
    // Not .dll: the print spooler and Bluetooth control-panel libraries Chromium imports.
    .concat(['winspool.drv', 'bthprops.cpl'])
)

/** Imports that are not files at all: the host process (Electron's node.exe delay-load hook). */
const HOST_IMPORTS = new Set(['node.exe', 'electron.exe'])

/** `name` (a lower-case DLL name) comes from Windows, not the package. */
function isSystemDll(name) {
  return (
    SYSTEM_DLLS.has(name) ||
    HOST_IMPORTS.has(name) ||
    /^(api|ext)-ms-win-[a-z0-9-]+(\.dll)?$/.test(name)
  )
}

/**
 * The bundled dependency closure of a win-unpacked package: every .node, .dll and
 * .exe in it (the app's own exe, Electron's DLLs, app.asar.unpacked, resources)
 * has its imports resolved. A system DLL (isSystemDll) is external; any other must
 * be a file of that name beside the importing binary or beside the app's exe.
 * Returns { binaries, imports, missing: [{ binary, dll }] }. `absent` (tests, and
 * the negative control) lists package-relative files to treat as not there.
 */
function dependencyClosure(packageDir, absent = []) {
  const gone = new Set(absent.map((rel) => rel.toLowerCase()))
  const files = listTree(packageDir).filter((rel) => !gone.has(rel.toLowerCase()))
  const byDir = new Map()
  for (const rel of files) {
    const dir = path.posix.dirname(rel).toLowerCase()
    if (!byDir.has(dir)) byDir.set(dir, new Set())
    byDir.get(dir).add(path.posix.basename(rel).toLowerCase())
  }
  const rootFiles = byDir.get('.') ?? new Set()
  const binaries = files.filter((rel) =>
    NATIVE_EXTENSIONS.includes(path.extname(rel).toLowerCase())
  )
  const missing = []
  let imports = 0
  for (const binary of binaries) {
    const here = byDir.get(path.posix.dirname(binary).toLowerCase()) ?? new Set()
    for (const dll of peImports(path.join(packageDir, ...binary.split('/')))) {
      imports++
      if (isSystemDll(dll) || here.has(dll) || rootFiles.has(dll)) continue
      missing.push({ binary, dll })
    }
  }
  return { binaries: binaries.length, imports, missing }
}

/**
 * ggml loads its CPU backends (ggml-cpu-<variant>.dll, one per instruction set) and
 * the Vulkan backend at run time from ggml-base.dll's folder; nothing imports them,
 * so the closure cannot see them. Every folder holding ggml-base.dll must have the
 * baseline ggml-cpu-x64.dll (loadable on any x64 CPU), the same CPU variants as every
 * other such folder in the package, and a *-vulkan build its ggml-vulkan.dll.
 * Problems as text; `absent` as for dependencyClosure.
 */
function ggmlBackendProblems(packageDir, absent = []) {
  const gone = new Set(absent.map((rel) => rel.toLowerCase()))
  const files = listTree(packageDir).filter((rel) => !gone.has(rel.toLowerCase()))
  const dirs = new Map()
  for (const rel of files) {
    const dir = path.posix.dirname(rel)
    if (!dirs.has(dir)) dirs.set(dir, new Set())
    dirs.get(dir).add(path.posix.basename(rel).toLowerCase())
  }
  const ggml = [...dirs].filter(([, names]) => names.has('ggml-base.dll'))
  const variants = new Set()
  for (const [, names] of ggml)
    for (const name of names) if (/^ggml-cpu-[a-z0-9]+\.dll$/.test(name)) variants.add(name)
  variants.add('ggml-cpu-x64.dll')
  const problems = []
  for (const [dir, names] of ggml) {
    for (const name of [...variants].sort())
      if (!names.has(name)) problems.push(`${dir}/${name}: ggml CPU backend missing`)
    if (/-vulkan$/i.test(dir) && !names.has('ggml-vulkan.dll'))
      problems.push(`${dir}/ggml-vulkan.dll: ggml Vulkan backend missing`)
  }
  return problems
}

/**
 * The closure must catch a missing bundled DLL: with `rel` treated as absent, a
 * binary that imports it must be reported. Returns the problems (none when caught).
 */
function closureNegativeControl(packageDir, rel) {
  const name = path.posix.basename(rel).toLowerCase()
  const { missing } = dependencyClosure(packageDir, [rel])
  return missing.some((m) => m.dll === name)
    ? []
    : [`dependency closure: with ${rel} absent nothing was reported missing (negative control)`]
}

/** Native binaries under app.asar.unpacked that cannot load in the x64 Windows app. */
function foreignNativeBinaries(unpackedDir) {
  const problems = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (NATIVE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        const machine = peMachine(full)
        if (machine !== 'x64')
          problems.push(
            `${path.relative(unpackedDir, full).replace(/\\/g, '/')}: ${machine === 'not-pe' ? 'not a Windows binary' : `PE machine ${machine}, not x64`}`
          )
      }
    }
  }
  if (fs.existsSync(unpackedDir)) walk(unpackedDir)
  return problems
}

module.exports = {
  readAsarHeader,
  listAsar,
  problemsFor,
  peMachine,
  foreignNativeBinaries,
  nativeBinariesInAsar,
  missingRequiredBinaries,
  missingRequiredResources,
  missingDependencies,
  REQUIRED_UNPACKED,
  REQUIRED_RESOURCES,
  peImports,
  isSystemDll,
  dependencyClosure,
  closureNegativeControl,
  ggmlBackendProblems,
  listTree,
  fileListDifferences
}

/** Every file under `dir`, relative and `/`-separated, sorted ([] when it does not exist). */
function listTree(dir) {
  const files = []
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(rel)
      else files.push(rel)
    }
  }
  if (fs.existsSync(dir)) walk('')
  return files.sort()
}

/** @electron/asar, resolved through electron-builder (no dependency of the app's own). */
function asarModule() {
  const desktop = path.join(__dirname, '..')
  const builder = path.dirname(
    require.resolve('electron-builder/package.json', { paths: [desktop] })
  )
  const lib = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [builder] }))
  return require(require.resolve('@electron/asar', { paths: [lib] }))
}

const sha256 = (buffer) => require('node:crypto').createHash('sha256').update(buffer).digest('hex')

/**
 * SHA-256 of every file packed inside the archive, by POSIX path: each extracted
 * with @electron/asar. Entries stored in app.asar.unpacked (`unpacked`) are hashed
 * there instead (unpackedHashes); a link is its target.
 */
function asarHashes(file, asar = asarModule()) {
  const out = new Map()
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, rel)
      else if (child.link) out.set(rel, `link:${child.link}`)
      else if (!child.unpacked)
        out.set(rel, sha256(asar.extractFile(file, rel.split('/').join(path.sep))))
    }
  }
  walk(readAsarHeader(file), '')
  return out
}

/** SHA-256 of every file under `dir`, by relative POSIX path. */
function treeHashes(dir) {
  return new Map(listTree(dir).map((rel) => [rel, sha256(fs.readFileSync(path.join(dir, rel)))]))
}

/**
 * The only files that may differ between two identity packages (QA and
 * production), and the only way each may differ (`check(here, there, { here,
 * there })` with both contents and both resources folders: null when the
 * difference is the expected one, else what is wrong). Everything else in
 * app.asar and app.asar.unpacked must be byte-identical.
 */
const IDENTITY_DIFFERENCES = {
  // electron-builder writes the identity's package name (scripts/package-win-qa.cjs
  // packages QA as desktop-qa: profile %APPDATA%\desktop-qa, install folder);
  // nothing else in it may change.
  'app.asar/package.json': (here, there) => {
    const [a, b] = [here, there].map((buffer) => JSON.parse(buffer.toString('utf8')))
    const names = new Set(['desktop', 'desktop-qa'])
    if (!names.has(a.name) || !names.has(b.name)) return `name ${a.name} / ${b.name}`
    const rest = (json) => JSON.stringify({ ...json, name: undefined })
    return rest(a) === rest(b) ? null : 'differs in more than "name"'
  },
  // electron-vite bakes two things in that differ between the two packages, and
  // nothing else may:
  // - the identity (src/main/app-identity.ts, __DOODLENOTE_IDENTITY__): APP_IDENTITY =
  //   appIdentity("qa" | "production") and, for QA only, its default dictation
  //   shortcuts: the block from `const QA_DICTATION_SHORTCUTS` / `function
  //   appIdentity(` to the end of the `const APP_IDENTITY = appIdentity(...)` call;
  // - the Bark helper's digest (__DOODLENOTE_HELPER_INTEGRITY__): each package
  //   build recompiles resources/engine/dictation-helper.exe with the inbox .NET
  //   Framework csc.exe, which has no /deterministic, so each bundle must carry
  //   exactly its own package's helper digest (authenticodeSha256 in the
  //   dictation-helper.manifest.json beside it).
  // Both are cut out (after those checks) and the rest compared byte for byte.
  'app.asar/out/main/index.js': (here, there, dirs) => {
    const cut = (text, resources) => {
      const from = ['const QA_DICTATION_SHORTCUTS', 'function appIdentity(']
        .map((marker) => text.indexOf(marker))
        .filter((at) => at >= 0)
      const call = text.indexOf('const APP_IDENTITY = appIdentity(')
      const to = call < 0 ? -1 : text.indexOf(');', call) + 2
      if (!from.length || to < 2) return { why: 'no identity block' }
      let rest = `${text.slice(0, Math.min(...from))}<identity>${text.slice(to)}`
      const digest = /(define_DOODLENOTE_HELPER_INTEGRITY_default = \{ digest: ")([0-9a-f]{64})(")/
      const found = digest.exec(rest)
      if (found) {
        const manifest = path.join(resources, 'engine', 'dictation-helper.manifest.json')
        const own = fs.existsSync(manifest)
          ? JSON.parse(fs.readFileSync(manifest, 'utf8')).authenticodeSha256
          : null
        if (found[2] !== own)
          return { why: `helper digest ${found[2]} is not this package's (${own})` }
        rest = rest.replace(digest, '$1<helper digest>$3')
      }
      return { rest }
    }
    const [a, b] = [cut(here.toString('utf8'), dirs.here), cut(there.toString('utf8'), dirs.there)]
    if (a.why || b.why) return a.why ?? b.why
    return a.rest === b.rest ? null : 'differs outside the identity block and the helper digest'
  }
}

/** Every difference between two `path -> hash` maps, under `name`, as problems. */
function hashDifferences(name, ours, theirs, otherDir) {
  const problems = []
  for (const rel of new Set([...ours.keys(), ...theirs.keys()])) {
    const label = `${name}/${rel}`
    if (!theirs.has(rel)) problems.push({ label, problem: 'only in this package' })
    else if (!ours.has(rel)) problems.push({ label, problem: `only in ${otherDir}` })
    else if (ours.get(rel) !== theirs.get(rel)) problems.push({ label, problem: 'content differs' })
  }
  return problems.sort((x, y) => (x.label < y.label ? -1 : 1))
}

/** What only `a` and only `b` hold, for two file lists. */
function fileListDifferences(a, b) {
  const inA = new Set(a)
  const inB = new Set(b)
  return { onlyA: a.filter((file) => !inB.has(file)), onlyB: b.filter((file) => !inA.has(file)) }
}

/**
 * Problems when the package at `asar` does not ship exactly the files of `otherDir`,
 * byte for byte, apart from IDENTITY_DIFFERENCES.
 */
function sameFilesProblems(asar, files, otherDir, { log = console.log, asarApi } = {}) {
  const problems = []
  const otherAsar = path.join(otherDir, 'resources', 'app.asar')
  const api = asarApi ?? asarModule()
  const pairs = [
    ['app.asar', asarHashes(asar, api), asarHashes(otherAsar, api)],
    ['app.asar.unpacked', treeHashes(`${asar}.unpacked`), treeHashes(`${otherAsar}.unpacked`)]
  ]
  const contents = (archive, rel) =>
    rel.startsWith('app.asar/')
      ? api.extractFile(archive, rel.slice('app.asar/'.length).split('/').join(path.sep))
      : fs.readFileSync(path.join(`${archive}.unpacked`, rel.slice('app.asar.unpacked/'.length)))
  for (const [name, ours, theirs] of pairs) {
    const differences = hashDifferences(name, ours, theirs, otherDir)
    let allowed = 0
    for (const { label, problem } of differences) {
      const check = IDENTITY_DIFFERENCES[label]
      if (problem === 'content differs' && check) {
        const why = check(contents(asar, label), contents(otherAsar, label), {
          here: path.dirname(asar),
          there: path.dirname(otherAsar)
        })
        if (!why) {
          allowed++
          log(`  ${label}: differs as the identity allows`)
          continue
        }
        problems.push(`${label}: ${why}`)
      } else problems.push(`${label}: ${problem}`)
    }
    log(
      `  ${name}: ${ours.size} files here, ${theirs.size} in ${otherDir}; ${ours.size - differences.length} identical (SHA-256), ${allowed} identity file(s), ${differences.length - allowed} other difference(s)`
    )
    if (ours.size === 0) problems.push(`${name}: no files`)
  }
  return problems
}

/**
 * Changes one byte of `file` at `offset` (XOR 0xff), runs `check`, and puts the
 * byte back (verified). Returns what `check` returned.
 */
function withFlippedByte(file, offset, check) {
  const fd = fs.openSync(file, 'r+')
  const byte = Buffer.alloc(1)
  try {
    fs.readSync(fd, byte, 0, 1, offset)
    const original = byte[0]
    fs.writeSync(fd, Buffer.from([original ^ 0xff]), 0, 1, offset)
    try {
      return check()
    } finally {
      fs.writeSync(fd, Buffer.from([original]), 0, 1, offset)
      fs.readSync(fd, byte, 0, 1, offset)
      if (byte[0] !== original) throw new Error(`${file}: byte ${offset} not restored`)
    }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * The negative control for --same-files-as: one byte changed in one file under
 * app.asar.unpacked, in one asar entry (inside its data, not the header), and in
 * out/main/index.js outside what IDENTITY_DIFFERENCES lets differ (its last
 * byte), must each be reported as exactly that file. Problems when one is missed.
 */
function negativeControlProblems(asar, files, otherDir) {
  const quiet = () => {}
  const problems = []
  const unpacked = listTree(`${asar}.unpacked`).find(
    (rel) => fs.statSync(path.join(`${asar}.unpacked`, rel)).size > 0
  )
  const { header, dataOffset } = readAsar(asar)
  const entry = (rel) => rel.split('/').reduce((node, name) => node.files[name], header)
  const packed = files.find((rel) => {
    if (IDENTITY_DIFFERENCES[`app.asar/${rel}`]) return false
    const node = entry(rel)
    return !node.unpacked && !node.link && node.size > 0
  })
  const cases = [
    [
      `app.asar.unpacked/${unpacked}`,
      path.join(`${asar}.unpacked`, unpacked),
      Math.floor(fs.statSync(path.join(`${asar}.unpacked`, unpacked)).size / 2)
    ],
    [
      `app.asar/${packed}`,
      asar,
      dataOffset + Number(entry(packed).offset) + Math.floor(entry(packed).size / 2)
    ],
    [
      'app.asar/out/main/index.js',
      asar,
      dataOffset + Number(entry('out/main/index.js').offset) + entry('out/main/index.js').size - 1,
      'differs outside the identity block and the helper digest'
    ]
  ]
  for (const [label, file, offset, why = 'content differs'] of cases) {
    const found = withFlippedByte(file, offset, () =>
      sameFilesProblems(asar, files, otherDir, { log: quiet })
    )
    const expected = [`${label}: ${why}`]
    const ok = JSON.stringify(found) === JSON.stringify(expected)
    console.log(
      `  negative control, one byte of ${label}: ${ok ? 'caught' : `NOT caught (${JSON.stringify(found)})`}`
    )
    if (!ok)
      problems.push(`negative control: one changed byte in ${label} was not reported exactly`)
  }
  const after = sameFilesProblems(asar, files, otherDir, { log: quiet })
  if (after.length)
    problems.push(`negative control: the package did not come back intact (${after[0]})`)
  return problems
}

module.exports.IDENTITY_DIFFERENCES = IDENTITY_DIFFERENCES
module.exports.sameFilesProblems = sameFilesProblems
module.exports.negativeControlProblems = negativeControlProblems
module.exports.asarHashes = asarHashes

if (require.main === module) {
  const args = process.argv.slice(2)
  const listIndex = args.indexOf('--list')
  const listFile = listIndex >= 0 ? args.splice(listIndex, 2)[1] : null
  const sameIndex = args.indexOf('--same-files-as')
  const sameAs = sameIndex >= 0 ? args.splice(sameIndex, 2)[1] : null
  const controlIndex = args.indexOf('--negative-control')
  const negativeControl = controlIndex >= 0 && Boolean(args.splice(controlIndex, 1))
  const target = args[0]
  if (!target) {
    console.error('usage: test-windows-package.cjs <win-unpacked dir | app.asar> [--list out.txt]')
    process.exit(2)
  }
  const asar = target.endsWith('.asar') ? target : path.join(target, 'resources', 'app.asar')
  const files = listAsar(asar)
  if (listFile) fs.writeFileSync(listFile, files.join('\n') + '\n')
  const tops = {}
  for (const file of files) tops[file.split('/')[0]] = (tops[file.split('/')[0]] ?? 0) + 1
  console.log(`${asar}: ${files.length} files`)
  for (const [top, count] of Object.entries(tops).sort()) console.log(`  ${top}: ${count}`)
  const problems = problemsFor(files)
  if (!files.includes('out/main/index.js')) problems.push('out/main/index.js is missing')
  if (!files.includes('package.json')) problems.push('package.json is missing')
  const unpacked = `${asar}.unpacked`
  const foreign = foreignNativeBinaries(unpacked)
  problems.push(...foreign.map((problem) => `app.asar.unpacked/${problem}`))
  console.log(
    `  app.asar.unpacked: ${foreign.length} native binaries that cannot load on Windows x64`
  )
  const missing = missingRequiredBinaries(unpacked)
  problems.push(
    ...missing.map((rel) => `app.asar.unpacked/${rel}: required Windows binary missing`)
  )
  console.log(
    `  app.asar.unpacked: ${REQUIRED_UNPACKED.length - missing.length}/${REQUIRED_UNPACKED.length} required Windows runtime binaries`
  )
  const missingResources = missingRequiredResources(path.dirname(asar))
  problems.push(
    ...missingResources.map((rel) => `resources/${rel}: required Windows resource missing`)
  )
  console.log(
    `  resources: ${REQUIRED_RESOURCES.length - missingResources.length}/${REQUIRED_RESOURCES.length} required files outside app.asar`
  )
  const { dependencies } = require(path.join(__dirname, '..', 'package.json'))
  const missingDeps = missingDependencies(files, dependencies)
  problems.push(...missingDeps.map((name) => `app.asar/node_modules/${name}: dependency missing`))
  console.log(
    `  app.asar: ${Object.keys(dependencies ?? {}).length - missingDeps.length}/${Object.keys(dependencies ?? {}).length} of the app's dependencies`
  )
  const packed = nativeBinariesInAsar(asar)
  for (const binary of packed) console.log(`  inside app.asar: ${binary.path} (${binary.machine})`)
  const packedForeign = packed.filter((binary) => binary.machine !== 'x64')
  problems.push(
    ...packedForeign.map(
      (binary) =>
        `app.asar/${binary.path}: ${binary.machine === 'not-pe' ? 'not a Windows binary' : `PE machine ${binary.machine}, not x64`}`
    )
  )
  console.log(
    `  inside app.asar: ${packed.length} native binaries, ${packedForeign.length} that cannot load on Windows x64`
  )
  // Round 7: every DLL a bundled binary imports is in the package (or is Windows'),
  // and ggml's run-time backends are there; with one ggml-base.dll treated as absent
  // the closure must report it (the check is never vacuous).
  if (!target.endsWith('.asar')) {
    const closure = dependencyClosure(target)
    problems.push(
      ...closure.missing.map(
        ({ binary, dll }) =>
          `${binary}: imports ${dll}, which is not in its folder or the app folder and is not a Windows DLL`
      )
    )
    console.log(
      `  dependency closure: ${closure.binaries} binaries, ${closure.imports} imports, ${closure.missing.length} bundled DLLs missing`
    )
    const backends = ggmlBackendProblems(target)
    problems.push(...backends)
    console.log(`  ggml run-time backends: ${backends.length} missing`)
    const base = listTree(target).find((rel) => /\/ggml-base\.dll$/i.test(rel))
    if (!base) problems.push('dependency closure negative control: no ggml-base.dll in the package')
    else {
      problems.push(...closureNegativeControl(target, base))
      problems.push(
        ...(ggmlBackendProblems(target, [base.replace(/ggml-base\.dll$/i, 'ggml-cpu-x64.dll')])
          .length
          ? []
          : ['ggml backend negative control: a missing ggml-cpu-x64.dll was not reported'])
      )
      console.log(
        `  negative control: ${base} and its ggml-cpu-x64.dll treated as absent are reported`
      )
    }
  }
  if (sameAs) problems.push(...sameFilesProblems(asar, files, sameAs))
  if (sameAs && negativeControl && !problems.length)
    problems.push(...negativeControlProblems(asar, files, sameAs))
  if (negativeControl && !sameAs) problems.push('--negative-control needs --same-files-as')
  if (problems.length) {
    console.error(`FAIL: ${problems.length} problem(s) in the Windows package`)
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`)
    if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`)
    process.exit(1)
  }
  console.log(
    'Windows app.asar contains only the built app and its runtime dependencies; native binaries are all x64 Windows'
  )
  if (sameAs)
    console.log(
      `Same app.asar entries and app.asar.unpacked files as ${sameAs}, byte for byte apart from the identity files${negativeControl ? '; one changed byte in any of them is caught' : ''}`
    )
}
