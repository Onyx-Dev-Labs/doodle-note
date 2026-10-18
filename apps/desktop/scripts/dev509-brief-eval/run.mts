import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, platform, release, arch } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  readCorpus,
  readRubric,
  corpusPath,
  RUBRIC_SHA256,
  CORPUS_SHA256,
  sha256
} from './corpus.mjs'
import { evaluateCase, mechanicalGenerator } from './evaluate.mjs'
import type { createNativeGenerator } from './native.mjs'

const args = process.argv.slice(2)
if (args.length && !(args.length === 2 && args[0] === '--native-config'))
  throw new Error(
    'Usage: run.mts [--native-config /explicit/coordinated/config.json]; default mechanical, no inference'
  )
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const git =
  process.platform === 'darwin' ? '/Library/Developer/CommandLineTools/usr/bin/git' : 'git'
const gitRead = (...input: string[]): string =>
  execFileSync(git, input, { cwd: repo, encoding: 'utf8' }).trim()
const corpus = readCorpus()
const rubric = readRubric()
const outputDir = mkdtempSync(join(tmpdir(), 'dev509-brief-evaluation-'))
const model: Awaited<ReturnType<typeof createNativeGenerator>> | undefined = args.length
  ? await (
      await import('./native.mjs')
    ).createNativeGenerator(JSON.parse(readFileSync(args[1]!, 'utf8')))
  : undefined
const generator = model?.generator ?? mechanicalGenerator
const implementationPaths = [
  'apps/desktop/src/main/brief-service.ts',
  'apps/desktop/src/main/cited-ask-service.ts',
  'packages/ai/src/local-engine.ts'
]
const report: Record<string, unknown> & { results: unknown[] } = {
  version: 1,
  startedAt: new Date().toISOString(),
  mode: generator.mode,
  native: generator.mode === 'native',
  semanticQuality: 'not-evaluated',
  acceptance: 'not-qualified',
  corpusSha256: CORPUS_SHA256,
  corpusFrozenAgainst: corpus.frozenAgainst,
  rubricSha256: RUBRIC_SHA256,
  gitHead: gitRead('rev-parse', 'HEAD'),
  gitStatus: gitRead('status', '--porcelain'),
  evaluatorSha256: Object.fromEntries(
    ['corpus.mts', 'fixture.mts', 'evaluate.mts', 'native.mts', 'run.mts'].map((name) => [
      name,
      sha256(readFileSync(join(dirname(fileURLToPath(import.meta.url)), name)))
    ])
  ),
  implementation: Object.fromEntries(
    implementationPaths.map((path) => [
      path,
      {
        lastCommit: gitRead('log', '-1', '--format=%H', '--', path),
        sha256: sha256(readFileSync(join(repo, path)))
      }
    ])
  ),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    lockSha256: sha256(readFileSync(join(repo, 'pnpm-lock.yaml')))
  },
  model: model?.provenance ?? null,
  results: [],
  cleanup: 'pending',
  limitations: [
    'Synthetic calendar and seeded context, no provider/accounts/native capture/Electron IPC.',
    'Native path uses same engine method but not NotesService app profile/policy lifecycle.',
    'Human support labels pending; no automatic semantic pass.',
    'No process-wide network/device instrumentation. No tools/actions wired into this evaluator.'
  ]
}
const writeReport = (): void =>
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
writeFileSync(join(outputDir, 'corpus.json'), readFileSync(corpusPath))
writeFileSync(join(outputDir, 'rubric.md'), rubric)
console.log(`DEV509 ${generator.mode} evaluation artifacts: ${outputDir}`)
let failed = false
const abort = new AbortController()
const interrupt = (): void => abort.abort(new Error('Evaluation interrupted; draining owned work'))
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)
try {
  for (const item of corpus.cases) {
    try {
      if (abort.signal.aborted) {
        failed = true
        report.results.push({ caseId: item.id, outcome: 'not-run-cancelled', native: false })
        writeReport()
        continue
      }
      const result = await evaluateCase(corpus, item, generator, abort.signal)
      report.results.push(result)
      if (
        !(generator.mode === 'mechanical'
          ? result.mechanicalPass
          : result.nativeMechanicalGatesPass)
      )
        failed = true
      console.log(
        `${item.id}: ${result.outcome}; source checks ${result.sourceChecksPass ? 'pass' : 'FAIL'}`
      )
    } catch (error) {
      failed = true
      report.results.push({
        caseId: item.id,
        outcome: 'harness-error',
        error: error instanceof Error ? error.stack : String(error),
        native: generator.mode === 'native',
        semanticQuality: 'not-evaluated'
      })
    }
    writeReport()
  }
} finally {
  try {
    await model?.dispose()
    report.cleanup = 'complete'
  } catch (error) {
    failed = true
    report.cleanup = { error: String(error) }
  }
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  report.finishedAt = new Date().toISOString()
  report.mechanicalGates = failed ? 'failed' : 'passed'
  // Even a fully green mechanical/native-structure run cannot approve semantic quality.
  writeReport()
}
if (failed) process.exitCode = 1
