#!/usr/bin/env node
// Smoke test for Bark's Windows dictation helper: it starts, announces itself, answers
// the NDJSON protocol, has no test ops compiled in, matches its manifest digest, and leaves when
// stdin closes. Needs no desktop interaction.
//   node scripts/test-dictation-helper-win.cjs <path to dictation-helper.exe> [--signing-fixture]
// --signing-fixture also signs a COPY of the helper with a temporary user-scoped self-signed
// certificate (removed afterwards; the signed copy is never executed) and checks the digest is the
// same before and after signing, that appended trailing bytes change it, and that the signer reads
// back as the test certificate.
const { spawn, execFileSync } = require('node:child_process')
const helper = process.argv[2]
if (!helper) {
  console.error('usage: test-dictation-helper-win.cjs <dictation-helper.exe>')
  process.exit(2)
}
// DICTATION_HELPER_TEST=1 is set on purpose: the shipped helper must still have no test ops.
const child = spawn(helper, [], {
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
  env: { ...process.env, DICTATION_HELPER_TEST: '1' }
})
const lines = []
let buffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
    lines.push(JSON.parse(buffer.slice(0, i)))
    buffer = buffer.slice(i + 1)
  }
})
const wait = (predicate, ms) =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const found = lines.find(predicate)
      if (found) {
        clearInterval(timer)
        resolve(found)
      } else if (Date.now() - started > ms) {
        clearInterval(timer)
        reject(new Error(`timed out; saw ${JSON.stringify(lines)}`))
      }
    }, 20)
  })
const send = (request) => child.stdin.write(`${JSON.stringify(request)}\n`)
async function main() {
  child.on('error', (error) => {
    console.error(`the helper did not start: ${error.code ?? error.message}`)
    process.exit(1)
  })
  const ready = await wait((l) => l.event === 'ready', 10_000)
  if (ready.platform !== 'win32') throw new Error('ready event without platform')
  send({ op: 'status', id: 's' })
  send({ op: 'request-accessibility', id: 'a' })
  send({ op: 'hold-start', id: 'f', key: 'fn', minHoldMs: 150 })
  send({ op: 'deliver', id: 'd', snapshotId: 'none', text: 'x' })
  send({ op: 'nope', id: 'u' })
  for (const op of [
    '__boundary-table',
    '__drop-hooks',
    '__state-lock-probe',
    '__runs-above',
    '__hooks-state'
  ])
    send({ op, id: op })
  const status = await wait((l) => l.id === 's', 10_000)
  const access = await wait((l) => l.id === 'a', 5_000)
  const fn = await wait((l) => l.id === 'f', 5_000)
  const deliver = await wait((l) => l.id === 'd', 5_000)
  const unknown = await wait((l) => l.id === 'u', 5_000)
  const testOps = []
  for (const op of [
    '__boundary-table',
    '__drop-hooks',
    '__state-lock-probe',
    '__runs-above',
    '__hooks-state'
  ])
    testOps.push(await wait((l) => l.id === op, 5_000))
  const checks = [
    [
      'status reply',
      status.ok === true &&
        status.accessibility === true &&
        typeof status.inputMonitoring === 'boolean'
    ],
    ['no Accessibility permission on Windows', access.trusted === true],
    ['Fn is not a Windows key', fn.ok === false && fn.reason === 'unknown-key'],
    [
      'a delivery without a snapshot is refused',
      deliver.outcome === 'refused' && deliver.reason === 'no-target'
    ],
    ['unknown op', unknown.ok === false && unknown.reason === 'unknown-op'],
    [
      'the shipped helper has no test ops (even with DICTATION_HELPER_TEST=1)',
      testOps.every((r) => r.ok === false && r.reason === 'unknown-op')
    ]
  ]
  const code = await new Promise((resolve) => {
    child.on('exit', resolve)
    child.stdin.end()
    setTimeout(() => resolve('timeout'), 5_000)
  })
  checks.push(['exits when stdin closes', code === 0])
  for (const [name, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${name}`)
  console.log(`hooks allowed: ${status.inputMonitoring}`)
  if (checks.some(([, ok]) => !ok)) process.exit(1)

  // Exercise the integrity path CI ships: the manifest's signing-invariant Authenticode digest
  // must match the file. The same value covers an unsigned build and a signed release, so this
  // check does not depend on whether the CI runner signed the exe.
  const { readFileSync, existsSync } = require('node:fs')
  const path = require('node:path')
  const buffer = readFileSync(helper)
  const manifestPath = path.join(path.dirname(helper), 'dictation-helper.manifest.json')
  if (!existsSync(manifestPath)) {
    console.error('not ok - helper has no manifest to verify against')
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.authenticodeSha256 !== 'string') {
    console.error('not ok - manifest has no authenticodeSha256 digest')
    process.exit(1)
  }
  const { stableDigest } = require('./authenticode-digest.cjs')
  const digest = stableDigest(buffer)
  if (digest !== manifest.authenticodeSha256) {
    console.error(`not ok - helper digest ${digest} != manifest ${manifest.authenticodeSha256}`)
    process.exit(1)
  }
  console.log('ok - helper matches its manifest Authenticode digest (signing-invariant)')
  if (process.argv.includes('--signing-fixture')) signingFixture(buffer)

  console.log('Windows dictation helper smoke passed')
}

/**
 * Real-signature fixture: sign a COPY of the helper with a temporary self-signed code-signing
 * certificate in the current user's store (removed in finally, from My and CA), never execute it,
 * and check the signing-invariant digest across signing and trailing bytes.
 */
function signingFixture(unsignedBytes) {
  const { mkdtempSync, writeFileSync, readFileSync, appendFileSync, rmSync } = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { stableDigest, peLayout } = require('./authenticode-digest.cjs')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dn-helper-sign-'))
  const copy = path.join(dir, 'helper-signed-copy.bin.exe')
  writeFileSync(copy, unsignedBytes)
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const subject = 'DoodleNote Helper Digest Fixture'
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=${subject}' -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(1)`,
    'try {',
    '  $set = Set-AuthenticodeSignature -LiteralPath $env:DN_COPY -Certificate $cert -HashAlgorithm SHA256',
    '  $s = Get-AuthenticodeSignature -LiteralPath $env:DN_COPY',
    '  $c = $s.SignerCertificate',
    '  [pscustomobject]@{ set = [string]$set.Status; status = [string]$s.Status; cn = $(if ($c) { $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { "" }); thumbprint = $(if ($c) { $c.Thumbprint } else { "" }); expected = $cert.Thumbprint } | ConvertTo-Json -Compress',
    '} finally {',
    '  Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\CurrentUser\\CA | Where-Object { $_.Thumbprint -eq $cert.Thumbprint } | Remove-Item',
    '}'
  ].join('\n')
  let info
  try {
    const out = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, DN_COPY: copy },
      windowsHide: true
    }).toString()
    info = JSON.parse(out.trim().split(/\r?\n/).pop())
    const signed = readFileSync(copy)
    const layout = peLayout(signed)
    const before = stableDigest(unsignedBytes)
    const after = stableDigest(signed)
    appendFileSync(copy, Buffer.from('trailing bytes after the certificate table'))
    const trailing = stableDigest(readFileSync(copy))
    const checks = [
      ['the copy carries a certificate table after signing', !!(layout && layout.table)],
      [
        'signer reads back as the fixture certificate',
        info.cn === subject && info.thumbprint === info.expected
      ],
      ['digest is identical before and after signing', !!before && before === after],
      [
        'trailing bytes after the certificate table change the digest',
        !!trailing && trailing !== after
      ]
    ]
    for (const [name, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${name}`)
    console.log(
      `signing fixture: before=${before} after=${after} trailing=${trailing} table=${JSON.stringify(layout && layout.table)} status=${info.status}`
    )
    if (checks.some(([, ok]) => !ok)) process.exit(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // The certificate must be gone from the user's stores.
  const left = execFileSync(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@(Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\CurrentUser\\CA | Where-Object { $_.Subject -eq 'CN=${subject}' }).Count`
    ],
    { windowsHide: true }
  )
    .toString()
    .trim()
  if (left !== '0') {
    console.error(`not ok - fixture certificate left in the user's store (${left})`)
    process.exit(1)
  }
  console.log('ok - fixture certificate removed from the user store')
}
main().catch((error) => {
  console.error(error)
  child.kill()
  process.exit(1)
})
