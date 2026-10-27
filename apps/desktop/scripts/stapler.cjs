// One retry owner for app packaging, DMG stapling and final ticket validation.
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const ENDPOINT =
  'https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery/production/public/records/lookup'
const ROLES = ['package-app', 'build-app', 'zip-app', 'dmg-app', 'dmg']
const OUTPUT_LIMIT = 64 * 1024
const POLICY = Object.freeze({
  attempts: 3,
  delaysMs: Object.freeze([10000, 30000]),
  timeoutMs: 60000,
  totalMs: 219000
})

function evidence(output) {
  // Project onto an allowlist, never persist arbitrary tool output, paths, headers,
  // environment, auth arguments or keychain data. Hash distinguishes repeated output.
  const codes = [...output.matchAll(/NSURLErrorDomain\s+Code=(-?\d+)\b/g)].map((m) => Number(m[1]))
  const urls = [
    ...output.matchAll(/NSErrorFailingURL(?:String)?Key=(https?:\/\/[^\s,}\]"<>]+)/g)
  ].map((m) => m[1])
  const terminal =
    /certificate|\bTLS\b|\bSSL\b|revoked|not trusted|trust evaluation|secure connection|not notarized|(?:missing|invalid|no|cannot find|could not find) (?:a |the )?(?:notarization )?ticket|ticket (?:is )?(?:missing|invalid|not found)|record not found|does not have a ticket|(?:could not|cannot|unable to|failed to) (?:find|load|validate|decode) [^\n]{0,100}ticket|ticket[^\n]{0,100}(?:not found|not available|does not exist)/i.test(
      output
    )
  return {
    urlErrorCodes: [...new Set(codes)].slice(0, 16),
    competingUrlError: codes.some((code) => code !== -1005),
    exactTicketEndpoint: urls.length > 0 && urls.every((url) => url === ENDPOINT),
    nullResponse: /(?:^|\n)\s*Response is \(null\)\s*(?:\n|$)/.test(output),
    terminalDiagnostic: terminal,
    taskIds: [
      ...new Set([...output.matchAll(/LocalDataTask <([A-Fa-f0-9-]{36})>/g)].map((m) => m[1]))
    ].slice(0, 4),
    outputSha256: createHash('sha256').update(output).digest('hex')
  }
}

function classify(result) {
  if (result.reason) return result.reason
  if (result.signal) return 'signal'
  if (result.code === 0) return 'success'
  const e = result.diagnostics
  if (e.terminalDiagnostic || e.competingUrlError) return 'terminal-diagnostic'
  if (e.urlErrorCodes.includes(-1005) && e.exactTicketEndpoint && e.nullResponse)
    return 'ticket-connection-lost'
  return 'unclassified'
}

function killGroup(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function runStapler(
  { action, role, artifact, diagnosticsDir = process.env.DOODLENOTE_STAPLER_DIAGNOSTICS },
  testing = {}
) {
  if (
    !['staple', 'validate'].includes(action) ||
    !ROLES.includes(role) ||
    typeof artifact !== 'string' ||
    !path.isAbsolute(artifact) ||
    /[\0\r\n]/.test(artifact)
  ) {
    throw new Error('Invalid stapler action, role or absolute artifact path')
  }
  // In-process test seam only; CLI/environment cannot override production limits.
  const delaysMs = testing.delaysMs ?? POLICY.delaysMs
  const timeoutMs = testing.timeoutMs ?? POLICY.timeoutMs
  const totalMs = testing.totalMs ?? POLICY.totalMs
  if (
    delaysMs.length !== 2 ||
    delaysMs.some((n, i) => !Number.isFinite(n) || n < 0 || n > POLICY.delaysMs[i]) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > POLICY.timeoutMs ||
    !Number.isFinite(totalMs) ||
    totalMs <= 0 ||
    totalMs > POLICY.totalMs
  ) {
    throw new Error('Invalid stapler timing configuration')
  }
  if (diagnosticsDir) {
    if (!path.isAbsolute(diagnosticsDir))
      throw new Error('Stapler diagnostics directory must be absolute')
    fs.mkdirSync(diagnosticsDir, { recursive: true, mode: 0o700 })
  }
  const started = performance.now()
  const attempts = []
  const finish = (code, reason) => {
    const summary = {
      action,
      role,
      code,
      reason,
      attempts: attempts.length,
      elapsedMs: Math.round(performance.now() - started)
    }
    if (diagnosticsDir)
      fs.writeFileSync(
        path.join(diagnosticsDir, `${action}-${role}-result.json`),
        JSON.stringify(summary) + '\n',
        { mode: 0o600 }
      )
    return { code, reason, attempts }
  }
  let child
  let stopReason
  let wake
  const stop = (reason) => {
    stopReason ??= reason
    killGroup(child)
    wake?.()
  }
  const listeners = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
    const listener = () => stop('cancelled')
    process.on(signal, listener)
    return { signal, listener }
  })
  const deadline = setTimeout(() => stop('total-timeout'), totalMs)
  try {
    for (let attempt = 1; attempt <= POLICY.attempts; attempt++) {
      if (stopReason) break
      const attemptStarted = performance.now()
      const result = await new Promise((resolve) => {
        const chunks = []
        let bytes = 0
        let reason
        let timer
        child = spawn(testing.executable ?? 'xcrun', ['stapler', action, '-v', artifact], {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        const capture = (chunk) => {
          const available = OUTPUT_LIMIT - bytes
          chunks.push(chunk.subarray(0, Math.max(0, available)))
          bytes += chunk.length
          if (bytes > OUTPUT_LIMIT) {
            reason = 'output-limit'
            // Stop collecting immediately; no unbounded array of empty chunks.
            child.stdout.removeListener('data', capture)
            child.stderr.removeListener('data', capture)
            child.stdout.resume()
            child.stderr.resume()
            killGroup(child)
          }
        }
        child.stdout.on('data', capture)
        child.stderr.on('data', capture)
        child.once('error', () => {
          reason = 'spawn-error'
        })
        // A child may exit while a descendant still owns its pipes. Kill the group
        // on exit as well as on timeout/cancel, and wait for close to drain pipes.
        child.once('exit', () => killGroup(child))
        timer = setTimeout(() => {
          reason = 'timeout'
          killGroup(child)
        }, timeoutMs)
        child.once('close', (code, signal) => {
          clearTimeout(timer)
          child = undefined
          const output = Buffer.concat(chunks).toString('utf8')
          resolve({
            code,
            signal,
            reason: stopReason ?? reason,
            diagnostics: evidence(output),
            capturedBytes: Math.min(bytes, OUTPUT_LIMIT)
          })
        })
      })
      const reason = classify(result)
      const retry = reason === 'ticket-connection-lost' && attempt < POLICY.attempts && !stopReason
      const record = {
        action,
        role,
        attempt,
        elapsedMs: Math.round(performance.now() - started),
        processElapsedMs: Math.round(performance.now() - attemptStarted),
        exit: result.code,
        signal: result.signal,
        reason,
        retry,
        delayMs: retry ? delaysMs[attempt - 1] : 0,
        capturedBytes: result.capturedBytes,
        diagnostics: result.diagnostics
      }
      attempts.push(record)
      const line = JSON.stringify(record) + '\n'
      if (diagnosticsDir)
        fs.writeFileSync(path.join(diagnosticsDir, `${action}-${role}-${attempt}.json`), line, {
          mode: 0o600
        })
      ;(testing.log ?? ((text) => process.stderr.write(text)))(line)
      if (!retry) return finish(reason === 'success' ? 0 : 1, reason)
      await new Promise((resolve) => {
        const timer = setTimeout(done, delaysMs[attempt - 1])
        function done() {
          clearTimeout(timer)
          wake = undefined
          resolve()
        }
        wake = done
        if (stopReason) done()
      })
    }
    return finish(1, stopReason ?? 'exhausted')
  } finally {
    clearTimeout(deadline)
    killGroup(child)
    for (const { signal, listener } of listeners) process.removeListener(signal, listener)
  }
}

module.exports = { runStapler, POLICY }
if (require.main === module) {
  const [action, role, artifact, ...extra] = process.argv.slice(2)
  Promise.resolve()
    .then(() => {
      if (extra.length) throw new Error('Unexpected arguments')
      return runStapler({ action, role, artifact: artifact && path.resolve(artifact) })
    })
    .then((result) => {
      process.exitCode = result.code
    })
    .catch(() => {
      // Configuration exceptions can contain sensitive filesystem paths; fail closed.
      process.stderr.write('stapler helper configuration or diagnostic write failed\n')
      process.exitCode = 1
    })
}
