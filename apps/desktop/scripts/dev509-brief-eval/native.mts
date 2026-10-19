import assert from 'node:assert/strict'
import { createReadStream, lstatSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import type { Generator } from './evaluate.mjs'

export interface NativeConfiguration {
  /** Explicit isolated cached path/root supplied by the coordinating parent, never auto-discovered. */
  approvedModelRoot: string
  modelPath: string
  sha256: string
  modelUri: string
}
export function validateNativeConfiguration(value: unknown): NativeConfiguration {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Native configuration required'
  )
  const v = value as Record<string, unknown>
  assert.deepEqual(Object.keys(v).sort(), ['approvedModelRoot', 'modelPath', 'modelUri', 'sha256'])
  for (const key of ['approvedModelRoot', 'modelPath', 'modelUri', 'sha256'])
    assert.equal(typeof v[key], 'string')
  assert(
    isAbsolute(v.approvedModelRoot as string) && isAbsolute(v.modelPath as string),
    'Explicit absolute isolated model paths required'
  )
  assert.match(v.sha256 as string, /^[a-f0-9]{64}$/)
  assert((v.modelUri as string).length > 0 && (v.modelUri as string).length <= 1024)
  return v as unknown as NativeConfiguration
}
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
/** Never called by mechanical mode. No prepare/download fallback and no response parser. */
export async function createNativeGenerator(raw: unknown) {
  const config = validateNativeConfiguration(raw)
  const modelRoot = realpathSync(config.approvedModelRoot)
  assert.equal(modelRoot, config.approvedModelRoot, 'Approved root must be canonical')
  assert.equal(
    realpathSync(config.modelPath),
    config.modelPath,
    'Model path must not traverse symlinks'
  )
  const inside = relative(modelRoot, config.modelPath)
  assert(
    inside && inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside),
    'Model must be inside explicit isolated root'
  )
  const stat = lstatSync(config.modelPath, { bigint: true })
  assert(stat.isFile() && !stat.isSymbolicLink())
  const fingerprint = (): string => {
    const current = lstatSync(config.modelPath, { bigint: true })
    return `${current.dev}:${current.ino}:${current.size}:${current.mtimeNs}:${current.ctimeNs}`
  }
  const token = fingerprint()
  assert.equal(await hashFile(config.modelPath), config.sha256, 'Cached model digest mismatch')
  assert.equal(fingerprint(), token, 'Model changed while hashing')
  // Dynamic import and explicit modelPath ensure mechanical runs do not initialize native code,
  // and this path cannot call resolveModelFile / download a missing model.
  const { LocalNotesEngine } = await import('@repo/ai')
  const engine = new LocalNotesEngine({
    modelUri: config.modelUri,
    modelPath: config.modelPath,
    modelsDir: modelRoot,
    contextSize: 16384,
    onDownloadProgress: () => {
      throw new Error('Downloads forbidden in brief evaluation')
    }
  })
  const current = (): void => {
    assert.equal(fingerprint(), token, 'Cached model identity changed')
  }
  const generator: Generator = {
    mode: 'native',
    generate: async (input, signal) => {
      current()
      const result = await engine.askWithEvidence(input, { signal, phase: 'writing' })
      current()
      return { ...result, engineId: engine.id, modelArtifactRevision: config.sha256 }
    },
    validateModel: async (id, revision) => {
      current()
      return id === engine.id && revision === config.sha256
    }
  }
  return {
    generator,
    provenance: {
      ...config,
      bytes: stat.size.toString(),
      engineId: engine.id,
      method: 'LocalNotesEngine.askWithEvidence',
      contextSize: 16384,
      temperature: 0.3,
      outputReserve: 4096,
      safetyMargin: 256,
      notesServiceProfileLifecycle: false
    },
    async dispose() {
      await engine.dispose()
      current()
      assert.equal(
        await hashFile(config.modelPath),
        config.sha256,
        'Model bytes changed during evaluation'
      )
      current()
    }
  }
}
