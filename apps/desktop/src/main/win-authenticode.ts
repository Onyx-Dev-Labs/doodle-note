/**
 * Windows Authenticode verification for the Bark helper, run asynchronously so the main process is
 * never blocked: Get-AuthenticodeSignature (WinVerifyTrust underneath: signature, chain to a trusted
 * root) in a separate powershell.exe, with the signer certificate's common name and thumbprint.
 *
 * Why PowerShell and not WinVerifyTrust through koffi: the app keeps Koffi out of the main process
 * (only the platform-guarded Windows speech worker may load it; release-packaging.test.ts), and the
 * helper itself cannot vouch for itself.
 *
 * Injection safety: powershell.exe is started by its full system path (no PATH lookup), and the
 * helper path reaches the script only as DATA, through an environment variable read with
 * -LiteralPath; it is never interpolated into the command text, so a folder named `$x` or `$(...)`
 * cannot change what runs.
 *
 * Anything that stops the check from producing a verdict (PowerShell missing or blocked by
 * AppLocker/WDAC, a crash, unparsable output, an unsupported file) is "unavailable"; the caller then
 * falls back to the digest. The caller also bounds the wait (SIGNATURE_BUDGET_MS).
 */
import { execFile } from 'node:child_process'
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

/**
 * The verifier's environment: the helper path as data (DN_HELPER_PATH), and WITHOUT PSModulePath.
 * A PSModulePath inherited from PowerShell 7 (an app started from a pwsh terminal) makes Windows
 * PowerShell 5.1 load PowerShell 7's security module, where the Authenticode cmdlets and the Cert:
 * drive are missing; 5.1 rebuilds its default module path when the variable is absent.
 */
export function verifierEnv(env: NodeJS.ProcessEnv, helperPath: string): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== 'PSMODULEPATH') clean[key] = value
  }
  clean.DN_HELPER_PATH = helperPath
  return clean
}

/** The script: reads the path from DN_HELPER_PATH (data), prints one JSON line. */
export const VERIFY_SCRIPT =
  "$ErrorActionPreference = 'Stop';" +
  '$s = Get-AuthenticodeSignature -LiteralPath $env:DN_HELPER_PATH;' +
  '$c = $s.SignerCertificate;' +
  '$cn = $null; $tp = $null;' +
  'if ($c) { $cn = $c.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false); $tp = $c.Thumbprint };' +
  '[pscustomobject]@{ status = [string]$s.Status; cn = $cn; thumbprint = $tp } | ConvertTo-Json -Compress'

/**
 * Get-AuthenticodeSignature statuses: Valid is a verdict of good; NotSigned, HashMismatch,
 * NotTrusted and UnknownError (an untrusted or broken chain) are verdicts of bad; the rest mean the
 * file could not be evaluated.
 */
export function classifySignatureStatus(status: unknown): 'valid' | 'invalid' | 'unavailable' {
  if (status === 'Valid') return 'valid'
  if (
    status === 'NotSigned' ||
    status === 'HashMismatch' ||
    status === 'NotTrusted' ||
    status === 'UnknownError'
  )
    return 'invalid'
  return 'unavailable'
}

/** Parse the script's output into a SignatureCheck. */
export function parseVerifyOutput(stdout: string): SignatureCheck {
  let parsed: { status?: unknown; cn?: unknown; thumbprint?: unknown }
  try {
    parsed = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? '') as typeof parsed
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

/** Verify a file's Authenticode signature asynchronously (see the module comment). */
export function verifyAuthenticode(path: string, timeoutMs = 10_000): Promise<SignatureCheck> {
  return new Promise<SignatureCheck>((resolve) => {
    try {
      execFile(
        systemPowerShell(),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', VERIFY_SCRIPT],
        {
          env: verifierEnv(process.env, path),
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 64 * 1024
        },
        (error, stdout) => {
          if (error) {
            const code = (error as NodeJS.ErrnoException).code
            resolve({
              status: 'unavailable',
              reason: code ? String(code) : error.message.slice(0, 120)
            })
            return
          }
          resolve(parseVerifyOutput(String(stdout)))
        }
      )
    } catch (error) {
      resolve({ status: 'unavailable', reason: error instanceof Error ? error.message : 'error' })
    }
  })
}
