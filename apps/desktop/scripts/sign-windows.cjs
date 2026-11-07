// Windows code signing for electron-builder (win.signtoolOptions.sign) and, as a
// CLI, for PE files electron-builder never offers to its signer (see main()).
//
// Signs with Microsoft Artifact Signing (formerly Trusted Signing) through
// SignTool and the Artifact Signing dlib when its settings and an Azure service
// principal are in the environment:
//
//   ARTIFACT_SIGNING_ENDPOINT   e.g. https://eus.codesigning.azure.net
//   ARTIFACT_SIGNING_ACCOUNT    the Artifact Signing account name
//   ARTIFACT_SIGNING_PROFILE    the certificate profile name
//   ARTIFACT_SIGNING_DLIB       path to bin\x64\Azure.CodeSigning.Dlib.dll
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
//   SIGNTOOL_PATH               optional; else the newest Windows SDK x64 signtool
//
// Without them it logs "signing skipped: no credentials" and leaves every file
// exactly as built, so unsigned CI builds are unchanged. A PFX supplied the
// electron-builder way (CSC_LINK / WIN_CSC_LINK) is still honoured.
//
// DOODLENOTE_SIGN_TEST_CERT_SHA1 (local plumbing checks only, refused in CI)
// signs with a CurrentUser\My certificate through Set-AuthenticodeSignature.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ARTIFACT_SIGNING_VARS = [
  'ARTIFACT_SIGNING_ENDPOINT',
  'ARTIFACT_SIGNING_ACCOUNT',
  'ARTIFACT_SIGNING_PROFILE',
  'ARTIFACT_SIGNING_DLIB',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET'
]
const TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com'
// Only the service principal in the environment; never a browser prompt or a
// developer's cached login on a build machine.
const EXCLUDED_CREDENTIALS = [
  'ManagedIdentityCredential',
  'WorkloadIdentityCredential',
  'SharedTokenCacheCredential',
  'VisualStudioCredential',
  'VisualStudioCodeCredential',
  'AzureCliCredential',
  'AzurePowerShellCredential',
  'AzureDeveloperCliCredential',
  'InteractiveBrowserCredential'
]
/** PE files the app ships; electron-builder's own walk covers only *.exe (plus signExts). */
const PE_EXTENSIONS = ['.exe', '.dll', '.node']

/**
 * Which signer this environment selects. Pure, for tests.
 * @returns {{ mode: 'artifact-signing', endpoint: string, account: string, profile: string, dlib: string }
 *   | { mode: 'certificate-file' } | { mode: 'test-certificate', thumbprint: string }
 *   | { mode: 'none', missing: string[] }}
 */
function signingPlan(env, { hasCertificateFile = false } = {}) {
  const present = ARTIFACT_SIGNING_VARS.filter((name) => (env[name] ?? '').trim() !== '')
  if (present.length === ARTIFACT_SIGNING_VARS.length) {
    const endpoint = env.ARTIFACT_SIGNING_ENDPOINT.trim()
    let host = ''
    try {
      const url = new URL(endpoint)
      host = url.protocol === 'https:' ? url.hostname : ''
    } catch {
      // reported below
    }
    if (!host.endsWith('.codesigning.azure.net')) {
      throw new Error(
        `ARTIFACT_SIGNING_ENDPOINT must be an https://<region>.codesigning.azure.net endpoint`
      )
    }
    return {
      mode: 'artifact-signing',
      endpoint,
      account: env.ARTIFACT_SIGNING_ACCOUNT.trim(),
      profile: env.ARTIFACT_SIGNING_PROFILE.trim(),
      dlib: env.ARTIFACT_SIGNING_DLIB.trim()
    }
  }
  if (present.length > 0) {
    // Half-configured signing must not quietly ship unsigned binaries.
    const missing = ARTIFACT_SIGNING_VARS.filter((name) => !present.includes(name))
    throw new Error(`Artifact Signing is partly configured; missing ${missing.join(', ')}`)
  }
  if (hasCertificateFile) return { mode: 'certificate-file' }
  const thumbprint = (env.DOODLENOTE_SIGN_TEST_CERT_SHA1 ?? '').trim()
  if (thumbprint) {
    if (env.CI) throw new Error('DOODLENOTE_SIGN_TEST_CERT_SHA1 is for local plumbing checks only')
    if (!/^[0-9A-Fa-f]{40}$/.test(thumbprint))
      throw new Error('DOODLENOTE_SIGN_TEST_CERT_SHA1 must be a 40-hex-digit thumbprint')
    return { mode: 'test-certificate', thumbprint: thumbprint.toUpperCase() }
  }
  return { mode: 'none', missing: ARTIFACT_SIGNING_VARS }
}

/** The dlib metadata.json body. */
function artifactSigningMetadata(plan) {
  return {
    Endpoint: plan.endpoint,
    CodeSigningAccountName: plan.account,
    CertificateProfileName: plan.profile,
    ExcludeCredentials: EXCLUDED_CREDENTIALS
  }
}

/** SignTool arguments for one file with Artifact Signing. */
function artifactSigningArgs(file, dlib, metadataFile) {
  return [
    'sign',
    '/v',
    '/fd',
    'SHA256',
    '/tr',
    TIMESTAMP_URL,
    '/td',
    'SHA256',
    '/dlib',
    dlib,
    '/dmdf',
    metadataFile,
    file
  ]
}

/** PE files under resources/ that electron-builder does not sign (outside app.asar.unpacked); for checks. */
function unsignedByBuilder(appOutDir) {
  const resources = path.join(appOutDir, 'resources')
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (full !== path.join(resources, 'app.asar.unpacked')) walk(full)
      } else if (PE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        found.push(full)
      }
    }
  }
  if (fs.existsSync(resources)) walk(resources)
  return found.sort()
}

function findSigntool(env) {
  if (env.SIGNTOOL_PATH) return env.SIGNTOOL_PATH
  const root = path.join(
    env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Windows Kits',
    '10',
    'bin'
  )
  const versions = fs.existsSync(root)
    ? fs
        .readdirSync(root)
        .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : []
  for (const version of versions.reverse()) {
    const candidate = path.join(root, version, 'x64', 'signtool.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('signtool.exe not found; install the Windows SDK or set SIGNTOOL_PATH')
}

let skipLogged = false
let metadataFile = null

/** True when SignTool already sees a valid signature (vendor-signed runtime DLLs keep theirs). */
function alreadySigned(signtool, file) {
  try {
    execFileSync(signtool, ['verify', '/pa', '/q', file], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Authenticode applies to PE files only; an ELF or Mach-O build for another OS is not one. */
function isPortableExecutable(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const magic = Buffer.alloc(2)
    return fs.readSync(fd, magic, 0, 2, 0) === 2 && magic.toString('latin1') === 'MZ'
  } finally {
    fs.closeSync(fd)
  }
}

/** Sign one file in place. `configuration` is electron-builder's sign-task configuration, when called by it. */
function signFile(file, configuration = {}, env = process.env) {
  const plan = signingPlan(env, { hasCertificateFile: configuration.cscInfo != null })
  if (plan.mode === 'none') {
    if (!skipLogged) {
      console.log('signing skipped: no credentials')
      skipLogged = true
    }
    return false
  }
  if (!isPortableExecutable(file)) {
    // test-windows-package.cjs fails the build if such a file ships.
    console.log(`not a Windows PE file, left unsigned: ${file}`)
    return false
  }
  if (plan.mode === 'test-certificate') {
    const script =
      `$c = Get-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${plan.thumbprint}'; ` +
      `$r = Set-AuthenticodeSignature -LiteralPath $env:DN_SIGN_FILE -Certificate $c -HashAlgorithm SHA256; ` +
      `if (-not $r.SignerCertificate) { throw "not signed: $($r.StatusMessage)" }`
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...env, DN_SIGN_FILE: file },
      stdio: ['ignore', 'inherit', 'inherit']
    })
    console.log(`signed with test certificate: ${file}`)
    return true
  }
  const signtool = findSigntool(env)
  if (plan.mode === 'certificate-file') {
    execFileSync(signtool, configuration.computeSignToolArgs(true), { stdio: 'inherit' })
    return true
  }
  if (alreadySigned(signtool, file)) {
    console.log(`already signed, kept: ${file}`)
    return true
  }
  if (!metadataFile) {
    metadataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dn-sign-')), 'metadata.json')
    fs.writeFileSync(metadataFile, JSON.stringify(artifactSigningMetadata(plan), null, 2))
  }
  execFileSync(signtool, artifactSigningArgs(file, plan.dlib, metadataFile), { stdio: 'inherit' })
  console.log(`signed with Artifact Signing: ${file}`)
  return true
}

/** electron-builder win.signtoolOptions.sign hook: called once per file (SHA-256 only). */
async function sign(configuration) {
  signFile(configuration.path, configuration)
}

/**
 * CLI: sign PE files electron-builder never offers to its signer. Single-file
 * extraResources (resources\engine\dictation-helper.exe) are copied without
 * its signing transformer, so package:win signs the helper here, right after
 * building it and before electron-builder runs. Anything that records the
 * helper's hash (its integrity manifest) must run after this step.
 *
 *   node scripts/sign-windows.cjs <file>...
 */
function main(files) {
  if (!files.length) throw new Error('usage: sign-windows.cjs <file>...')
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`)
    signFile(path.resolve(file))
  }
}

module.exports = sign
module.exports.default = sign
module.exports.sign = sign
module.exports.signingPlan = signingPlan
module.exports.artifactSigningArgs = artifactSigningArgs
module.exports.artifactSigningMetadata = artifactSigningMetadata
module.exports.unsignedByBuilder = unsignedByBuilder

if (require.main === module) main(process.argv.slice(2))
module.exports.ARTIFACT_SIGNING_VARS = ARTIFACT_SIGNING_VARS
