// Diagnostic evidence only. Never creates candidate archives or a release receipt.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const dir = process.env.DOODLENOTE_STAPLER_DIAGNOSTICS
const stages = [
  'checkout',
  'tooling',
  'credentials',
  'node',
  'pnpm',
  'dependencies',
  'swift',
  'whisper',
  'brand',
  'package',
  'dmg',
  'verify',
  'candidate'
]

function save(name, value) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('Diagnostic directory required')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const text = JSON.stringify(value, null, 2) + '\n'
  if (Buffer.byteLength(text) > 16384) throw new Error('Diagnostic size limit')
  fs.writeFileSync(path.join(dir, name), text, { mode: 0o600 })
}
function field(name, pattern) {
  const value = process.env[name] ?? ''
  return value.length <= 128 && pattern.test(value) ? value : null
}
async function accepted() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > 65536) {
      save('notary-dmg.json', { accepted: false, reason: 'output-limit' })
      process.exitCode = 1
      return
    }
    chunks.push(chunk)
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    /* fail closed */
  }
  const status = ['Accepted', 'Invalid', 'Rejected', 'In Progress'].includes(parsed?.status)
    ? parsed.status
    : 'unknown'
  const id = typeof parsed?.id === 'string' && /^[a-f0-9-]{36}$/i.test(parsed.id) ? parsed.id : null
  const ok = status === 'Accepted' && id !== null
  save('notary-dmg.json', { accepted: ok, status, id })
  if (!ok) process.exitCode = 1
}
async function collect() {
  const raw = process.env.RELEASE_STAGE_OUTCOMES ?? '{}'
  if (raw.length > 4096) throw new Error('Stage input limit')
  const supplied = JSON.parse(raw)
  const outcomes = Object.fromEntries(
    stages.map((key) => [
      key,
      ['success', 'failure', 'cancelled', 'skipped'].includes(supplied[key])
        ? supplied[key]
        : 'unknown'
    ])
  )
  const desktop = path.resolve(__dirname, '..')
  const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid version')
  const artifacts = []
  for (const name of [
    `DoodleNote-${version}-arm64-mac.zip`,
    `DoodleNote-${version}-arm64.dmg`,
    'latest-mac.yml'
  ]) {
    const file = path.join(desktop, 'release', name)
    let stat
    try {
      stat = fs.lstatSync(file)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!stat.isFile()) continue
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    artifacts.push({
      name,
      bytes: stat.size,
      sha256: hash.digest('hex'),
      verified: outcomes.verify === 'success'
    })
  }
  let cdHash = null
  const app = path.join(desktop, 'release/mac-arm64/DoodleNote.app')
  if (fs.existsSync(app)) {
    const result = spawnSync('codesign', ['--display', '--verbose=4', app], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 16384
    })
    cdHash = /^CDHash=([a-f0-9]{40,64})$/im.exec(result.stderr ?? '')?.[1] ?? null
  }
  const tool = spawnSync('xcrun', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4096
  })
  save('summary.json', {
    runId: field('GITHUB_RUN_ID', /^\d+$/),
    runAttempt: field('GITHUB_RUN_ATTEMPT', /^\d+$/),
    sourceSha: field('GITHUB_SHA', /^[a-f0-9]{40}$/),
    runnerImage: field('ImageOS', /^[a-zA-Z0-9.-]+$/),
    runnerImageVersion: field('ImageVersion', /^[a-zA-Z0-9.-]+$/),
    platform: os.platform(),
    arch: os.arch(),
    kernel: os.release(),
    node: process.version,
    xcrun: /xcrun version (\d+(?:\.\d+)*)/i.exec(tool.stdout ?? '')?.[1] ?? null,
    stages: outcomes,
    artifacts,
    cdHash,
    appAcceptanceEvidence: fs.existsSync(path.join(dir, 'staple-package-app-1.json'))
      ? 'inferred-from-post-Accepted-staple-boundary; submission-id-unavailable'
      : 'unavailable',
    candidateRecovery: 'unavailable-without-retained-bytes'
  })
}
Promise.resolve()
  .then(() => {
    if (process.argv[2] === 'accepted') return accepted()
    if (process.argv[2] === 'collect') return collect()
    throw new Error('Invalid diagnostic action')
  })
  .catch(() => {
    process.stderr.write('release diagnostic collection failed\n')
    process.exitCode = 1
  })
