import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const signScript = fileURLToPath(new URL('../../scripts/sign-windows.cjs', import.meta.url))
const signing = createRequire(import.meta.url)(signScript) as {
  ARTIFACT_SIGNING_VARS: string[]
  signingPlan(
    env: Record<string, string | undefined>,
    options?: { hasCertificateFile?: boolean }
  ): {
    mode: string
    [key: string]: unknown
  }
  artifactSigningArgs(file: string, dlib: string, metadata: string): string[]
  artifactSigningMetadata(plan: object): { ExcludeCredentials: string[]; [key: string]: unknown }
  unsignedByBuilder(appOutDir: string): string[]
}
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')
const builderConfig = read('../../electron-builder.yml')
const ci = read('../../../../.github/workflows/ci.yml')
const desktopPackage = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> }
const verifyScript = read('../../scripts/verify-windows-signature.ps1')

const configured = {
  ARTIFACT_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
  ARTIFACT_SIGNING_ACCOUNT: 'onyx-dev-labs',
  ARTIFACT_SIGNING_PROFILE: 'doodlenote-public',
  ARTIFACT_SIGNING_DLIB: 'C:\\t\\bin\\x64\\Azure.CodeSigning.Dlib.dll',
  AZURE_TENANT_ID: 'tenant',
  AZURE_CLIENT_ID: 'client',
  AZURE_CLIENT_SECRET: 'secret'
}

test('without credentials signing is skipped, so CI builds stay unsigned as before', () => {
  assert.equal(signing.signingPlan({}).mode, 'none')
  // GitHub expands an absent secret to an empty string.
  const empty = Object.fromEntries(signing.ARTIFACT_SIGNING_VARS.map((name) => [name, '']))
  assert.equal(signing.signingPlan(empty).mode, 'none')
})

test('Artifact Signing is selected only when fully configured with a codesigning endpoint', () => {
  assert.deepEqual(signing.signingPlan(configured), {
    mode: 'artifact-signing',
    endpoint: configured.ARTIFACT_SIGNING_ENDPOINT,
    account: 'onyx-dev-labs',
    profile: 'doodlenote-public',
    dlib: configured.ARTIFACT_SIGNING_DLIB
  })
  assert.throws(
    () => signing.signingPlan({ ...configured, AZURE_CLIENT_SECRET: '' }),
    /partly configured; missing AZURE_CLIENT_SECRET/
  )
  for (const endpoint of ['http://eus.codesigning.azure.net', 'https://evil.example.com', 'eus']) {
    assert.throws(
      () => signing.signingPlan({ ...configured, ARTIFACT_SIGNING_ENDPOINT: endpoint }),
      /codesigning\.azure\.net/
    )
  }
})

test('a PFX supplied the electron-builder way and the local test certificate still work', () => {
  assert.equal(signing.signingPlan({}, { hasCertificateFile: true }).mode, 'certificate-file')
  const thumbprint = 'ab'.repeat(20)
  assert.deepEqual(signing.signingPlan({ DOODLENOTE_SIGN_TEST_CERT_SHA1: thumbprint }), {
    mode: 'test-certificate',
    thumbprint: thumbprint.toUpperCase()
  })
  assert.throws(
    () => signing.signingPlan({ DOODLENOTE_SIGN_TEST_CERT_SHA1: thumbprint, CI: 'true' }),
    /local plumbing checks only/
  )
  assert.throws(() => signing.signingPlan({ DOODLENOTE_SIGN_TEST_CERT_SHA1: 'x' }), /40-hex/)
})

test('SignTool runs the Artifact Signing dlib with SHA-256 and an RFC 3161 timestamp', () => {
  const args = signing.artifactSigningArgs('C:\\a\\DoodleNote.exe', 'C:\\dlib.dll', 'C:\\m.json')
  assert.deepEqual(args.slice(0, 1), ['sign'])
  const after = (flag: string): string => args[args.indexOf(flag) + 1]
  assert.equal(after('/fd'), 'SHA256')
  assert.equal(after('/td'), 'SHA256')
  assert.equal(after('/tr'), 'http://timestamp.acs.microsoft.com')
  assert.equal(after('/dlib'), 'C:\\dlib.dll')
  assert.equal(after('/dmdf'), 'C:\\m.json')
  assert.equal(args.at(-1), 'C:\\a\\DoodleNote.exe')
  const metadata = signing.artifactSigningMetadata(signing.signingPlan(configured))
  assert.equal(metadata.CodeSigningAccountName, 'onyx-dev-labs')
  assert.equal(metadata.CertificateProfileName, 'doodlenote-public')
  // Only the environment service principal; no browser or cached developer login.
  assert.ok(!metadata.ExcludeCredentials.includes('EnvironmentCredential'))
  assert.ok(metadata.ExcludeCredentials.includes('InteractiveBrowserCredential'))
})

test('the CLI leaves a file byte-identical and says why when there are no credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-sign-'))
  try {
    const file = join(dir, 'dictation-helper.exe')
    const bytes = Buffer.from('MZ not really a PE')
    writeFileSync(file, bytes)
    const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }
    const out = execFileSync(process.execPath, [signScript, file], { env, encoding: 'utf8' })
    assert.match(out, /signing skipped: no credentials/)
    assert.deepEqual(readFileSync(file), bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the files electron-builder never offers to its signer are found outside app.asar.unpacked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-pe-'))
  try {
    for (const rel of [
      'resources/engine/dictation-helper.exe',
      'resources/engine/dictation-helper.manifest.json',
      'resources/app.asar.unpacked/node_modules/koffi/build/koffi.node',
      'resources/tray/dog.ico',
      'DoodleNote.exe'
    ]) {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), '')
    }
    assert.deepEqual(signing.unsignedByBuilder(dir), [
      join(dir, 'resources', 'engine', 'dictation-helper.exe')
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('packaging signs the helper before anything else reads it, and every PE through the hook', () => {
  assert.match(builderConfig, /^ {2}signtoolOptions:\n {4}sign: scripts\/sign-windows\.cjs$/m)
  assert.match(builderConfig, /^ {4}signingHashAlgorithms: \[sha256\]$/m)
  assert.match(builderConfig, /^ {2}signExts: \["\.dll", "\.node"\]$/m)
  const steps = desktopPackage.scripts['package:win'].split(' && ')
  const built = steps.indexOf('node scripts/build-dictation-helper-win.cjs')
  const signed = steps.indexOf(
    'node scripts/sign-windows.cjs ../../engine/.build/windows/dictation-helper.exe'
  )
  assert.ok(built >= 0 && signed === built + 1)
  assert.ok(signed < steps.findIndex((step) => step.startsWith('electron-builder')))
})

test('CI signs only with configured secrets, scoped to the packaging step, and verifies every PE', () => {
  assert.match(ci, /signing skipped: no credentials/)
  assert.match(ci, /microsoft\.artifactsigning\.client\.1\.0\.151\.nupkg/)
  assert.match(ci, /35375A4BC4E1102DA729FC3D8D9925F774C3BAAE6B8B7FF6398D948CA9AB0D8A/)
  assert.match(ci, /actions\/setup-dotnet@[0-9a-f]{40} # v6\.0\.0/)
  // Secrets appear in the availability check and the packaging step only.
  const job = ci.slice(ci.indexOf('  windows-package:'))
  const step = job.slice(job.indexOf('- name: Build Windows installer'))
  const packageStep = step.slice(0, step.indexOf('\n      - '))
  for (const name of ['ARTIFACT_SIGNING_ACCOUNT', 'AZURE_CLIENT_SECRET']) {
    assert.match(packageStep, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`))
    const uses = job.split(`secrets.${name}`).length - 1
    assert.equal(uses, 2, `${name} is used only to detect signing and in the packaging step`)
  }
  assert.match(ci, /steps\.signing\.outputs\.enabled[\s\S]*verify-windows-signature\.ps1/)
  assert.match(verifyScript, /"\.exe", "\.dll", "\.node"/)
  assert.match(verifyScript, /dictation-helper\.exe/)
})
