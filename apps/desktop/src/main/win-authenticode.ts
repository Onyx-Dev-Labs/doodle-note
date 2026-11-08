/**
 * Windows Authenticode verification for the Bark helper, run asynchronously so the main process is
 * never blocked, in a separate powershell.exe that ALSO holds the helper file locked until the app
 * has started it:
 *
 *   1. it opens the helper with FileShare.Read (writing, renaming and deleting are denied) and prints
 *      {"locked":true} (or {"locked":false} when it cannot);
 *   2. it reads one command line: "verify" runs Get-AuthenticodeSignature (WinVerifyTrust underneath:
 *      signature and chain to a trusted root) and prints {status, cn, thumbprint}; "skip" prints
 *      {"status":"Skipped"} (unsigned helper, or a verdict already cached);
 *   3. it holds the handle until it reads "release" (or stdin closes), then exits.
 *
 * The app hashes the file and spawns the helper while the handle is held (CreateProcess only needs
 * read sharing), so the bytes it checked are the bytes that run.
 *
 * Why PowerShell and not WinVerifyTrust through koffi: the app keeps Koffi out of the main process
 * (only the platform-guarded Windows speech worker may load it; release-packaging.test.ts), and the
 * helper itself cannot vouch for itself.
 *
 * Injection safety: powershell.exe is started by its full system path (no PATH lookup); the helper
 * path reaches the script only as DATA in an environment variable read with -LiteralPath and
 * [IO.File]::Open; it is never part of the command text. PSModulePath is removed so an app started
 * from a PowerShell 7 terminal still gets Windows PowerShell's own security module.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { join } from 'node:path'
import type { SignatureCheck } from './helper-integrity'

/** powershell.exe by its full path under the Windows directory. */
export function systemPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.SystemRoot || env.windir || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
}

/** The verifier's environment: the helper path as data, and no inherited PSModulePath. */
export function verifierEnv(env: NodeJS.ProcessEnv, helperPath: string): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== 'PSMODULEPATH') clean[key] = value
  }
  clean.DN_HELPER_PATH = helperPath
  return clean
}

/** The lock-verify-hold script (see the module comment). Reads the path from DN_HELPER_PATH only. */
export const VERIFY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }',
  '$fs = $null',
  "try { $fs = [IO.File]::Open($env:DN_HELPER_PATH, 'Open', 'Read', 'Read') } catch { Say([pscustomobject]@{ locked = $false }); exit 0 }",
  'Say([pscustomobject]@{ locked = $true })',
  '$command = [Console]::In.ReadLine()',
  "if ($command -eq 'verify') {",
  '  try {',
  '    $s = Get-AuthenticodeSignature -LiteralPath $env:DN_HELPER_PATH',
  '    $c = $s.SignerCertificate; $cn = $null; $tp = $null',
  '    if ($c) { $cn = $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false); $tp = $c.Thumbprint }',
  '    Say([pscustomobject]@{ status = [string]$s.Status; cn = $cn; thumbprint = $tp })',
  "  } catch { Say([pscustomobject]@{ status = 'Error' }) }",
  "} else { Say([pscustomobject]@{ status = 'Skipped' }) }",
  '[void][Console]::In.ReadLine()',
  '$fs.Dispose()'
].join('\n')

/**
 * Get-AuthenticodeSignature statuses. Valid: good. HashMismatch, and NotSigned on a file that carries
 * a certificate table: the signature is broken, i.e. tampering (definitive). NotTrusted and
 * UnknownError are chain-trust failures (for example an offline machine missing the signing root):
 * not proof of tampering, so they count as "could not verify" and the digest decides; they are not
 * persisted and are re-checked on the next spawn. NotSupportedFileFormat, Incompatible, Error and
 * anything unknown: could not verify.
 */
export function classifySignatureStatus(status: unknown): 'valid' | 'invalid' | 'unavailable' {
  if (status === 'Valid') return 'valid'
  if (status === 'HashMismatch' || status === 'NotSigned') return 'invalid'
  return 'unavailable'
}

/** Parse the verdict line into a SignatureCheck. */
export function parseVerifyOutput(line: string): SignatureCheck {
  let parsed: { status?: unknown; cn?: unknown; thumbprint?: unknown }
  try {
    parsed = JSON.parse(line.trim()) as typeof parsed
  } catch {
    return { status: 'unavailable', reason: 'unreadable verifier output' }
  }
  const kind = classifySignatureStatus(parsed.status)
  if (kind === 'valid')
    return {
      status: 'valid',
      subjectCn: typeof parsed.cn === 'string' && parsed.cn ? parsed.cn : null,
      thumbprint:
        typeof parsed.thumbprint === 'string' && parsed.thumbprint
          ? parsed.thumbprint.toUpperCase()
          : null
    }
  if (kind === 'invalid') return { status: 'invalid', code: String(parsed.status) }
  return { status: 'unavailable', reason: `status ${String(parsed.status)}` }
}

/** A running verifier: holds the helper locked from `locked` until release()/kill(). */
export interface VerifierSession {
  /** True once the verifier holds the file (write/rename/delete denied); false if it could not. */
  locked: Promise<boolean>
  /** Ask for the signature ("verify") or not ("skip"); resolves with the verdict line's meaning. */
  check(verify: boolean): Promise<SignatureCheck>
  /** Let the verifier drop the lock and exit. */
  release(): void
  /** End it now (budget exceeded, or a lease never released). */
  kill(): void
}

/** Start the lock-and-verify process for `path` (see the module comment). */
export function startVerifier(path: string): VerifierSession {
  let child: ChildProcessByStdio<Writable, Readable, null> | null = null
  const lines: string[] = []
  const waiters: Array<(line: string | null) => void> = []
  let ended = false
  const nextLine = (): Promise<string | null> =>
    lines.length
      ? Promise.resolve(lines.shift()!)
      : ended
        ? Promise.resolve(null)
        : new Promise((resolve) => waiters.push(resolve))
  const end = (): void => {
    ended = true
    while (waiters.length) waiters.shift()!(null)
  }
  try {
    const proc = spawn(
      systemPowerShell(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', VERIFY_SCRIPT],
      { env: verifierEnv(process.env, path), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    child = proc
    let buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (!line) continue
        const waiter = waiters.shift()
        if (waiter) waiter(line)
        else lines.push(line)
      }
    })
    proc.on('error', end)
    proc.on('exit', end)
    proc.stdin.on('error', () => {})
  } catch {
    end()
  }
  const write = (text: string): void => {
    try {
      if (child && !ended) child.stdin.write(text)
    } catch {
      // The verifier is gone; the caller treats that as no lock / no verdict.
    }
  }
  const locked = nextLine().then((line) => {
    if (!line) return false
    try {
      return (JSON.parse(line) as { locked?: unknown }).locked === true
    } catch {
      return false
    }
  })
  return {
    locked,
    async check(verify) {
      write(verify ? 'verify\n' : 'skip\n')
      const line = await nextLine()
      if (line === null) return { status: 'unavailable', reason: 'verifier ended' }
      return parseVerifyOutput(line)
    },
    release() {
      write('release\n')
      try {
        child?.stdin.end()
      } catch {
        // Already closed.
      }
    },
    kill() {
      try {
        child?.kill()
      } catch {
        // Already gone.
      }
      end()
    }
  }
}
