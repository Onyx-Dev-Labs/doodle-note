#!/usr/bin/env node
// Writes engine/.build/windows/dictation-helper.manifest.json for Bark's Windows helper:
//   - authenticodeSha256: the signing-invariant digest (scripts/authenticode-digest.cjs), the same
//     before and after signing;
//   - signed / publisherCn / thumbprints: when the helper has been signed, the signer's exact
//     common name and certificate thumbprint, read from the signed file, so the app pins them;
//     when it is unsigned, publisherCn is the expected publisher (DOODLENOTE_HELPER_PUBLISHER_CN,
//     default below) and thumbprints is empty.
// electron-vite bakes these values into the app (electron.vite.config.ts), so package:win must run:
//   build-dictation-helper-win.cjs -> [sign the helper] -> write-dictation-helper-manifest.cjs
//   -> electron-vite build -> electron-builder
// (pinned by helper-integrity.test.ts). Re-running it is harmless.
//
//   node scripts/write-dictation-helper-manifest.cjs [path to dictation-helper.exe]
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { stableDigest, peLayout } = require('./authenticode-digest.cjs')

/**
 * The publisher CN expected on a signed helper. Microsoft Artifact Signing issues certificates whose
 * subject CN is the validated organization's legal name; set DOODLENOTE_HELPER_PUBLISHER_CN to it at
 * build time. When the helper is signed, the actual signer CN is recorded and, if this variable is
 * set, must equal it (a mismatch fails the build).
 */
const DEFAULT_PUBLISHER_CN = 'Onyx Dev Labs LLC'

const repo = path.resolve(__dirname, '..', '..', '..')
const defaultHelper = path.join(repo, 'engine', '.build', 'windows', 'dictation-helper.exe')

/** Windows PowerShell 5.1 must not inherit PowerShell 7's PSModulePath (Cert: drive / Authenticode cmdlets go missing). */
function windowsPowerShellEnv(extra) {
  const env = {}
  for (const [key, value] of Object.entries(process.env))
    if (key.toUpperCase() !== 'PSMODULEPATH') env[key] = value
  return { ...env, ...extra }
}

function signer(file) {
  // Get-AuthenticodeSignature with the path passed as DATA (an environment variable read inside the
  // script), never interpolated into the command, and powershell.exe by its full system path.
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const script =
    "$ErrorActionPreference='Stop';" +
    '$s = Get-AuthenticodeSignature -LiteralPath $env:DN_HELPER_PATH;' +
    '$c = $s.SignerCertificate;' +
    "[pscustomobject]@{ status = [string]$s.Status; cn = $(if ($c) { $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }); thumbprint = $(if ($c) { $c.Thumbprint } else { '' }) } | ConvertTo-Json -Compress"
  const out = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: windowsPowerShellEnv({ DN_HELPER_PATH: file }),
    windowsHide: true
  }).toString()
  return JSON.parse(out)
}

function main(helperPath = defaultHelper) {
  const helper = path.resolve(helperPath)
  const manifestPath = path.join(path.dirname(helper), 'dictation-helper.manifest.json')
  const bytes = readFileSync(helper)
  const layout = peLayout(bytes)
  if (!layout) throw new Error(`${helper} is not a valid PE image`)
  const digest = stableDigest(bytes)
  if (!digest) throw new Error(`could not compute the helper digest of ${helper}`)
  const configured = process.env.DOODLENOTE_HELPER_PUBLISHER_CN?.trim() || null
  let signed = false
  let publisherCn = configured || DEFAULT_PUBLISHER_CN
  let thumbprints = []
  if (layout.table) {
    if (process.platform !== 'win32')
      throw new Error('a signed helper can only be inspected on Windows')
    const info = signer(helper)
    if (!info.cn || !info.thumbprint)
      throw new Error(`the helper carries a signature without a readable signer (${info.status})`)
    if (configured && info.cn !== configured)
      throw new Error(`the helper is signed by "${info.cn}", not the expected "${configured}"`)
    signed = true
    publisherCn = info.cn
    thumbprints = [String(info.thumbprint).toUpperCase()]
  }
  const version = JSON.parse(
    readFileSync(path.join(repo, 'apps', 'desktop', 'package.json'), 'utf8')
  ).version
  const manifest = {
    name: 'dictation-helper.exe',
    version,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    authenticodeSha256: digest,
    signed,
    publisherCn,
    thumbprints
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `manifest authenticode=${digest.slice(0, 12)}… signed=${signed} publisher="${publisherCn}" version=${version}`
  )
}

if (require.main === module)
  main(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined)
module.exports = { main, DEFAULT_PUBLISHER_CN }
