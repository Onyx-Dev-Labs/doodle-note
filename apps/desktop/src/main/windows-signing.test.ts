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
  SIGNING_ENV_VARS: string[]
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
  signtoolPath(env: Record<string, string | undefined>): string
  signtoolProblem(facts: {
    status: string
    subject: string
    version: string
    originalFilename?: string
  }): string | null
  SIGNTOOL_SDK_VERSION: string
}
// Windows CI checks files out with CRLF line endings.
const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const builderConfig = read('../../electron-builder.yml')
const ci = read('../../../../.github/workflows/ci.yml')
const signWorkflow = read('../../../../.github/workflows/windows-sign.yml')
const qaDoc = read('../../../../docs/WINDOWS-RELEASE-QA.md')
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
    dlib: configured.ARTIFACT_SIGNING_DLIB,
    credential: 'client-secret'
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

test('a PFX is refused, so the helper can never ship unsigned beside signed files', () => {
  for (const env of [{ CSC_LINK: 'C:\\cert.pfx' }, { WIN_CSC_LINK: 'base64...' }]) {
    assert.throws(() => signing.signingPlan(env), /PFX signing .* is not supported/)
    assert.throws(() => signing.signingPlan({ ...configured, ...env }), /not supported/)
  }
  // electron-builder's own certificate context (cscInfo) is refused too.
  assert.throws(() => signing.signingPlan({}, { hasCertificateFile: true }), /not supported/)
  // GitHub expands an absent secret to an empty string: not a PFX.
  assert.equal(signing.signingPlan({ CSC_LINK: '', WIN_CSC_LINK: ' ' }).mode, 'none')
})

test('the local test certificate still works, outside CI only', () => {
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

test('SignTool is pinned and must be a Microsoft-signed, new enough build', () => {
  assert.equal(signing.SIGNTOOL_SDK_VERSION, '10.0.26100.0')
  assert.equal(
    signing.signtoolPath({ 'ProgramFiles(x86)': 'C:\\PF86' }),
    join('C:\\PF86', 'Windows Kits', '10', 'bin', '10.0.26100.0', 'x64', 'signtool.exe')
  )
  assert.equal(
    signing.signtoolPath({ SIGNTOOL_PATH: ' D:\\sdk\\signtool.exe ' }),
    'D:\\sdk\\signtool.exe'
  )
  const microsoft =
    'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'
  assert.equal(
    signing.signtoolProblem({
      status: 'Valid',
      subject: microsoft,
      version: '10.0.26100.4188',
      originalFilename: 'signtool.exe'
    }),
    null
  )
  assert.equal(
    signing.signtoolProblem({
      status: 'Valid',
      subject: microsoft,
      version: '10.0.22621.755',
      originalFilename: 'signtool.exe'
    }),
    null
  )
  assert.match(
    signing.signtoolProblem({
      status: 'Valid',
      subject: microsoft,
      version: '10.0.22621.754',
      originalFilename: 'signtool.exe'
    }) ?? '',
    /older than 10\.0\.22621\.755/
  )
  assert.match(
    signing.signtoolProblem({ status: 'NotSigned', subject: '', version: '10.0.26100.1' }) ?? '',
    /not validly signed/
  )
  assert.match(
    signing.signtoolProblem({
      status: 'Valid',
      subject: 'CN=Microsoft Corporation Fake, O=Evil',
      version: '10.0.26100.1',
      originalFilename: 'signtool.exe'
    }) ?? '',
    /signed by CN=Microsoft Corporation Fake/
  )
  const windows = 'CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'
  assert.equal(
    signing.signtoolProblem({
      status: 'Valid',
      subject: windows,
      version: '10.0.26100.1',
      originalFilename: 'signtool.exe'
    }),
    null
  )
  assert.match(
    signing.signtoolProblem({
      status: 'Valid',
      subject: 'CN=Microsoft Corporation, O=Someone Else',
      version: '10.0.26100.1',
      originalFilename: 'signtool.exe'
    }) ?? '',
    /signed by/
  )
  // Any other Microsoft-signed binary (ping.exe) is refused; the name is case-insensitive.
  const ping = { status: 'Valid', subject: windows, version: '10.0.26100.1' }
  assert.match(
    signing.signtoolProblem({ ...ping, originalFilename: 'ping.exe' }) ?? '',
    /not SignTool \(original file name ping\.exe\)/
  )
  assert.match(signing.signtoolProblem(ping) ?? '', /not SignTool \(original file name missing\)/)
  assert.equal(signing.signtoolProblem({ ...ping, originalFilename: 'SignTool.EXE' }), null)
  assert.match(
    readFileSync(signScript, 'utf8'),
    /originalFilename = \[string\]\$v\.OriginalFilename/
  )
  // No "newest SDK found on the machine" fallback any more.
  assert.doesNotMatch(readFileSync(signScript, 'utf8'), /readdirSync\(root\)/)
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
  assert.ok(metadata.ExcludeCredentials.includes('WorkloadIdentityCredential'))
})

test('an OIDC federated token (WorkloadIdentityCredential) can replace the client secret', () => {
  const oidc: Record<string, string> = {
    ...configured,
    AZURE_FEDERATED_TOKEN_FILE: 'C:\\runner\\temp\\oidc-token'
  }
  delete oidc.AZURE_CLIENT_SECRET
  const plan = signing.signingPlan(oidc) as { mode: string; credential?: string }
  assert.equal(plan.mode, 'artifact-signing')
  assert.equal(plan.credential, 'workload-identity')
  const metadata = signing.artifactSigningMetadata(plan)
  assert.ok(!metadata.ExcludeCredentials.includes('WorkloadIdentityCredential'))
  // Then only that one: not the environment secret, and never the Azure CLI's session.
  for (const name of [
    'EnvironmentCredential',
    'AzureCliCredential',
    'InteractiveBrowserCredential'
  ])
    assert.ok(metadata.ExcludeCredentials.includes(name), name)
  assert.throws(
    () => signing.signingPlan({ ...oidc, AZURE_CLIENT_SECRET: 'secret' }),
    /either AZURE_CLIENT_SECRET or AZURE_FEDERATED_TOKEN_FILE, not both/
  )
  assert.throws(
    () => signing.signingPlan({ ...oidc, AZURE_CLIENT_ID: '' }),
    /partly configured; missing AZURE_CLIENT_ID/
  )
  // A token file alone is a partial configuration, never silently "no credentials".
  assert.throws(() => signing.signingPlan({ AZURE_FEDERATED_TOKEN_FILE: 'x' }), /partly configured/)
  assert.ok(signing.SIGNING_ENV_VARS.includes('AZURE_FEDERATED_TOKEN_FILE'))
  assert.match(qaDoc, /OIDC/)
  assert.match(qaDoc, /AZURE_FEDERATED_TOKEN_FILE/)
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

test('the CLI refuses a PFX instead of leaving the helper unsigned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-sign-'))
  try {
    const file = join(dir, 'dictation-helper.exe')
    const bytes = Buffer.from('MZ not really a PE')
    writeFileSync(file, bytes)
    const env = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      CSC_LINK: join(dir, 'cert.pfx')
    }
    assert.throws(
      () => execFileSync(process.execPath, [signScript, file], { env, stdio: 'pipe' }),
      (error: { stderr?: Buffer }) => /PFX signing/.test(String(error.stderr))
    )
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
  assert.match(builderConfig, /^ {2}signtoolOptions:\n {4}sign: \.\/scripts\/sign-windows\.cjs$/m)
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

test('PR and branch CI never sees a signing secret and builds unsigned', () => {
  const job = ci.slice(ci.indexOf('  windows-package:'))
  // No secret of any kind in the job that runs PR-controlled scripts.
  assert.doesNotMatch(job, /secrets\./)
  assert.doesNotMatch(job, /CSC_LINK|ARTIFACT_SIGNING_|AZURE_CLIENT_SECRET|setup-dotnet/)
  assert.match(job, /- name: Build Windows installer\n\s+run: pnpm --filter desktop package:win\n/)
  // Any signature on an installer it built triggers the full verification.
  assert.match(
    job,
    /if \(\$signature\.Status -ne "NotSigned"\) \{[\s\S]*?verify-windows-signature\.ps1/
  )
  assert.match(job, /signing skipped: no credentials/)
  assert.match(verifyScript, /"\.exe", "\.dll", "\.node"/)
  assert.match(verifyScript, /dictation-helper\.exe/)
})

test('signing runs only by hand on main or a tag, in the protected windows-signing environment', () => {
  const triggers = signWorkflow.slice(
    signWorkflow.indexOf('\non:'),
    signWorkflow.indexOf('\npermissions:')
  )
  assert.match(triggers, /^\s+workflow_dispatch:\s*$/m)
  assert.doesNotMatch(triggers, /pull_request|push:|schedule|workflow_run/)
  assert.match(signWorkflow, /^ {4}environment: windows-signing$/m)
  assert.match(
    signWorkflow,
    /if: github\.repository == 'Onyx-Dev-Labs\/doodle-note' && \(github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)\)/
  )
  assert.match(signWorkflow, /persist-credentials: false/)
  // A v* tag (matched by name only) must point at a commit on main, checked before any secret.
  const ancestry = signWorkflow.indexOf('git merge-base --is-ancestor $env:GITHUB_SHA origin/main')
  assert.ok(ancestry > 0)
  assert.ok(ancestry < signWorkflow.indexOf('- name: Check Artifact Signing configuration'))
  assert.match(signWorkflow, /fetch-depth: 0/)
  assert.match(signWorkflow, /if \(\$LASTEXITCODE -ne 0\) \{ throw "\$env:GITHUB_REF/)
  assert.match(signWorkflow, /microsoft\.artifactsigning\.client\.1\.0\.151\.nupkg/)
  assert.match(signWorkflow, /35375A4BC4E1102DA729FC3D8D9925F774C3BAAE6B8B7FF6398D948CA9AB0D8A/)
  assert.match(signWorkflow, /actions\/setup-dotnet@[0-9a-f]{40} # v6\.0\.0/)
  assert.match(signWorkflow, /Windows Kits\\10\\bin\\10\.0\.26100\.0\\x64\\signtool\.exe/)
  // Secrets: the configuration check and the packaging step only.
  const packageStep = signWorkflow.slice(
    signWorkflow.indexOf('- name: Build signed Windows installer'),
    signWorkflow.indexOf('- name: Check Windows app.asar contents')
  )
  for (const name of signing.ARTIFACT_SIGNING_VARS.filter((n) => n !== 'ARTIFACT_SIGNING_DLIB')) {
    assert.match(packageStep, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`))
    assert.equal(signWorkflow.split(`secrets.${name}`).length - 1, 2, name)
  }
  assert.match(
    signWorkflow,
    /- name: Verify every shipped PE is signed\n[\s\S]*?verify-windows-signature\.ps1/
  )
  assert.doesNotMatch(
    signWorkflow,
    /publish-release|publish:win|release:win|--publish always|CSC_LINK/
  )
  // The environment's protection comes first, then the secrets.
  assert.match(
    qaDoc,
    /\*\*Create the environment with its protection rules before adding any secret\*\*/
  )
})
