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
  // Stop at 219s; independent cleanup gets 500ms, leaving 500ms to finalize.
  totalMs: 219000,
  cleanupMs: 500
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
  if (!child?.pid) return 'not-started'
  try {
    process.kill(-child.pid, 'SIGKILL')
    return 'sent'
  } catch (error) {
    return error.code === 'ESRCH' ? 'not-found' : 'failed'
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
  const cleanupMs = testing.cleanupMs ?? POLICY.cleanupMs
  if (
    delaysMs.length !== 2 ||
    delaysMs.some((n, i) => !Number.isFinite(n) || n < 0 || n > POLICY.delaysMs[i]) ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > POLICY.timeoutMs ||
    !Number.isFinite(totalMs) ||
    totalMs <= 0 ||
    totalMs > POLICY.totalMs ||
    !Number.isFinite(cleanupMs) ||
    cleanupMs <= 0 ||
    cleanupMs > POLICY.cleanupMs
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
  let stopAttempt
  const stop = (reason) => {
    stopReason ??= reason
    stopAttempt?.(reason)
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
        let firstFailure
        let cleanupTimer
        let groupSignal
        let settled = false
        let childExitObserved = false
        let exitCode = null
        let exitSignal = null
        const ownedChild = spawn(
          testing.executable ?? 'xcrun',
          ['stapler', action, '-v', artifact],
          {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )
        child = ownedChild
        const finalize = (forced = false) => {
          if (settled) return
          // Read EOF facts before destroying streams: a resulting close event is
          // not evidence of natural drainage or of an escaped descendant's exit.
          const stdoutDrained = ownedChild.stdout.readableEnded
          const stderrDrained = ownedChild.stderr.readableEnded
          const unconfirmed =
            forced ||
            groupSignal === 'failed' ||
            (Boolean(ownedChild.pid) && (!childExitObserved || !stdoutDrained || !stderrDrained))
          settled = true
          clearTimeout(timer)
          clearTimeout(cleanupTimer)
          stopAttempt = undefined
          ownedChild.stdout.removeListener('data', capture)
          ownedChild.stderr.removeListener('data', capture)
          ownedChild.removeListener('exit', onExit)
          ownedChild.removeListener('close', onClose)
          if (unconfirmed) {
            ownedChild.stdout.destroy()
            ownedChild.stderr.destroy()
            ownedChild.unref()
          }
          child = undefined
          const output = Buffer.concat(chunks).toString('utf8')
          const diagnostics = evidence(output)
          const failureReason =
            firstFailure === 'child-exit'
              ? classify({ code: exitCode, signal: exitSignal, diagnostics })
              : (firstFailure ?? null)
          chunks.length = 0
          resolve({
            code: exitCode,
            signal: exitSignal,
            reason: unconfirmed ? 'cleanup-unconfirmed' : reason,
            failureReason: unconfirmed ? failureReason : null,
            cleanup: {
              groupSignal,
              childExitObserved,
              stdoutDrained,
              stderrDrained,
              forcedReadClose: unconfirmed
            },
            diagnostics,
            capturedBytes: Math.min(bytes, OUTPUT_LIMIT)
          })
        }
        const beginCleanup = (cause) => {
          if (settled) return
          // Preserve the first meaningful failure even if a later deadline fires.
          reason ??= cause
          firstFailure ??= cause
          // One exact-group SIGKILL attempt; repeated signals after exit can
          // race group teardown. A signal error is evidence, never confirmation.
          groupSignal ??= killGroup(ownedChild)
          cleanupTimer ??= setTimeout(() => finalize(true), cleanupMs)
        }
        stopAttempt = beginCleanup
        const capture = (chunk) => {
          const available = OUTPUT_LIMIT - bytes
          chunks.push(chunk.subarray(0, Math.max(0, available)))
          bytes += chunk.length
          if (bytes > OUTPUT_LIMIT) {
            // Stop collecting immediately; no unbounded array of empty chunks.
            ownedChild.stdout.removeListener('data', capture)
            ownedChild.stderr.removeListener('data', capture)
            ownedChild.stdout.resume()
            ownedChild.stderr.resume()
            beginCleanup('output-limit')
          }
        }
        const onExit = (code, signal) => {
          childExitObserved = true
          exitCode = code
          exitSignal = signal
          clearTimeout(timer)
          // Classify output only after drainage; exit may precede buffered data.
          if (code !== 0) firstFailure ??= 'child-exit'
          beginCleanup(undefined)
        }
        const onClose = (code, signal) => {
          exitCode = code
          exitSignal = signal
          finalize()
        }
        ownedChild.stdout.on('data', capture)
        ownedChild.stderr.on('data', capture)
        // Keep an inert error listener after forced completion so a late spawn
        // error cannot become uncaught; it cannot mutate a completed result.
        ownedChild.on('error', () => {
          if (!settled) beginCleanup('spawn-error')
        })
        ownedChild.once('exit', onExit)
        ownedChild.once('close', onClose)
        const timer = setTimeout(() => beginCleanup('timeout'), timeoutMs)
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
        failureReason: result.failureReason,
        cleanup: result.cleanup,
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
