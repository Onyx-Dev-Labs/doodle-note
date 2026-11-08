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
//   AZURE_TENANT_ID / AZURE_CLIENT_ID and exactly one credential:
//   AZURE_CLIENT_SECRET         a service principal secret (EnvironmentCredential), or
//   AZURE_FEDERATED_TOKEN_FILE  an OIDC federated token file (WorkloadIdentityCredential),
//                               the preferred path once the Azure app registration
//                               trusts the windows-signing environment
//                               (docs/WINDOWS-RELEASE-QA.md "Code signing")
//   SIGNTOOL_PATH               optional; else the pinned Windows SDK x64 signtool
//                               (SIGNTOOL_SDK_VERSION). Either way it must be
//                               validly signed by Microsoft and at least
//                               SIGNTOOL_MIN_VERSION before it is used.
//
// Without them it logs "signing skipped: no credentials" and leaves every file
// exactly as built, so unsigned CI builds are unchanged. A PFX supplied the
// electron-builder way (CSC_LINK / WIN_CSC_LINK) is refused: this CLI never
// receives electron-builder's certificate context, so the Bark helper would
// ship unsigned while the files electron-builder offers were signed.
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
/** The OIDC alternative to AZURE_CLIENT_SECRET. */
const FEDERATED_TOKEN_VAR = 'AZURE_FEDERATED_TOKEN_FILE'
/** Everything that can select or feed a signer (stripped from QA builds). */
const SIGNING_ENV_VARS = [...ARTIFACT_SIGNING_VARS, FEDERATED_TOKEN_VAR]
const TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com'
// Only the credential this environment configured (a service principal secret,
// or an OIDC federated token); never a browser prompt, a developer's cached
// login or the Azure CLI's session on a build machine.
const EXCLUDED_CREDENTIALS = [
  'ManagedIdentityCredential',
  'SharedTokenCacheCredential',
  'VisualStudioCredential',
  'VisualStudioCodeCredential',
  'AzureCliCredential',
  'AzurePowerShellCredential',
  'AzureDeveloperCliCredential',
  'InteractiveBrowserCredential'
]
// SignTool is not fetched with the build, so pin which one runs: Windows SDK
// 10.0.26100 (on GitHub's windows-latest image); Artifact Signing's dlib needs
// 10.0.22621.755 or later.
const SIGNTOOL_SDK_VERSION = '10.0.26100.0'
const SIGNTOOL_MIN_VERSION = [10, 0, 22621, 755]
const CERTIFICATE_FILE_VARS = ['CSC_LINK', 'WIN_CSC_LINK']
/** PE files the app ships; electron-builder's own walk covers only *.exe (plus signExts). */
const PE_EXTENSIONS = ['.exe', '.dll', '.node']

/**
 * Which signer this environment selects. Pure, for tests.
 * @returns {{ mode: 'artifact-signing', endpoint: string, account: string, profile: string, dlib: string,
 *     credential: 'client-secret' | 'workload-identity' }
 *   | { mode: 'test-certificate', thumbprint: string } | { mode: 'none', missing: string[] }}
 */
function signingPlan(env, { hasCertificateFile = false } = {}) {
  const pfx = CERTIFICATE_FILE_VARS.filter((name) => (env[name] ?? '').trim() !== '')
  if (hasCertificateFile || pfx.length > 0) {
    throw new Error(
      `PFX signing (${pfx.join(', ') || 'a certificate file'}) is not supported: the Bark helper ` +
        'would ship unsigned. Unset it and use Microsoft Artifact Signing (ARTIFACT_SIGNING_*).'
    )
  }
  const set = (name) => (env[name] ?? '').trim() !== ''
  const base = ARTIFACT_SIGNING_VARS.filter((name) => name !== 'AZURE_CLIENT_SECRET')
  const present = base.filter(set)
  const secret = set('AZURE_CLIENT_SECRET')
  const federated = set(FEDERATED_TOKEN_VAR)
  if (present.length > 0 || secret || federated) {
    // Half-configured signing must not quietly ship unsigned binaries.
    const missing = base.filter((name) => !present.includes(name))
    if (!secret && !federated) missing.push(`AZURE_CLIENT_SECRET (or ${FEDERATED_TOKEN_VAR})`)
    if (missing.length > 0)
      throw new Error(`Artifact Signing is partly configured; missing ${missing.join(', ')}`)
    if (secret && federated)
      throw new Error(`Set either AZURE_CLIENT_SECRET or ${FEDERATED_TOKEN_VAR}, not both`)
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
      dlib: env.ARTIFACT_SIGNING_DLIB.trim(),
      credential: secret ? 'client-secret' : 'workload-identity'
    }
  }
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
    // DefaultAzureCredential then tries only the one credential configured.
    ExcludeCredentials: [
      ...EXCLUDED_CREDENTIALS,
      plan.credential === 'workload-identity'
        ? 'EnvironmentCredential'
        : 'WorkloadIdentityCredential'
    ]
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

/** The SignTool to run: SIGNTOOL_PATH, else the pinned SDK version (never "newest found"). */
function signtoolPath(env) {
  const configured = (env.SIGNTOOL_PATH ?? '').trim()
  if (configured) return configured
  return path.join(
    env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Windows Kits',
    '10',
    'bin',
    SIGNTOOL_SDK_VERSION,
    'x64',
    'signtool.exe'
  )
}

/** Why this SignTool must not be used, or null. Pure, for tests. */
function signtoolProblem({ status, subject, version, originalFilename }) {
  if (status !== 'Valid') return `it is not validly signed (${status})`
  // Microsoft's two code-signing subjects; the chain is checked by Status above.
  if (!/^CN=Microsoft (Corporation|Windows), O=Microsoft Corporation,/.test(subject ?? ''))
    return `it is signed by ${subject}`
  // Any Microsoft-signed binary passes the two checks above (ping.exe would); the
  // version resource's original name, covered by the signature, must be SignTool's.
  if (String(originalFilename ?? '').toLowerCase() !== 'signtool.exe')
    return `it is not SignTool (original file name ${originalFilename || 'missing'})`
  const parts = String(version ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
  for (let i = 0; i < SIGNTOOL_MIN_VERSION.length; i++) {
    const part = Number.isFinite(parts[i]) ? parts[i] : 0
    if (part > SIGNTOOL_MIN_VERSION[i]) return null
    if (part < SIGNTOOL_MIN_VERSION[i])
      return `version ${version} is older than ${SIGNTOOL_MIN_VERSION.join('.')}`
  }
  return null
}

let verifiedSigntool = null

/** The pinned SignTool, after checking its Authenticode signature and version (once). */
function findSigntool(env) {
  const file = signtoolPath(env)
  if (verifiedSigntool === file) return file
  if (!fs.existsSync(file)) {
    throw new Error(
      `signtool.exe not found at ${file}; install Windows SDK ${SIGNTOOL_SDK_VERSION} or set SIGNTOOL_PATH`
    )
  }
  const facts = signtoolFacts(file)
  const problem = signtoolProblem(facts)
  if (problem) throw new Error(`Refusing to run ${file}: ${problem}`)
  console.log(`signtool: ${file} (${facts.version}, ${facts.status})`)
  verifiedSigntool = file
  return file
}

/** Authenticode status, signer subject, file version and original file name of an executable (Windows). */
function signtoolFacts(file) {
  const script =
    '$s = Get-AuthenticodeSignature -LiteralPath $env:DN_SIGNTOOL; ' +
    '$v = (Get-Item -LiteralPath $env:DN_SIGNTOOL).VersionInfo; ' +
    '[pscustomobject]@{ status = [string]$s.Status; subject = [string]$s.SignerCertificate.Subject; ' +
    'version = "$($v.FileMajorPart).$($v.FileMinorPart).$($v.FileBuildPart).$($v.FilePrivatePart)"; ' +
    'originalFilename = [string]$v.OriginalFilename } | ' +
    'ConvertTo-Json -Compress'
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, DN_SIGNTOOL: file },
      encoding: 'utf8'
    })
  )
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
 * Order in package:win: helper build -> helper sign (here) ->
 * write-dictation-helper-manifest.cjs (records the signing-invariant digest
 * and, once signed, the signer's CN and thumbprint, which the app pins) ->
 * electron-vite build -> electron-builder.
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
module.exports.signtoolPath = signtoolPath
module.exports.signtoolProblem = signtoolProblem
module.exports.signtoolFacts = signtoolFacts
module.exports.SIGNTOOL_SDK_VERSION = SIGNTOOL_SDK_VERSION

if (require.main === module) main(process.argv.slice(2))
module.exports.ARTIFACT_SIGNING_VARS = ARTIFACT_SIGNING_VARS
module.exports.SIGNING_ENV_VARS = SIGNING_ENV_VARS
