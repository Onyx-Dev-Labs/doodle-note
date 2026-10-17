import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { RecipeDraft, RecipeOutput, RecipeVersion } from '../shared/recipes-api'

interface RecipeFile {
  format: 1
  versions: RecipeVersion[]
  outputs: RecipeOutput[]
  [key: string]: unknown
}
export function validateRecipe(value: RecipeDraft): RecipeDraft {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 120 ||
    typeof value.prompt !== 'string' ||
    !value.prompt.trim() ||
    value.prompt.length > 100_000 ||
    value.scope !== 'current-meeting' ||
    !['markdown', 'checklist', 'email-draft'].includes(value.outputKind) ||
    !['local-only', 'explicit-cloud'].includes(value.policy) ||
    !value.inputs ||
    !['personalNotes', 'transcript', 'selectedSummary'].every(
      (k) => typeof value.inputs[k] === 'boolean'
    ) ||
    ![value.inputs.personalNotes, value.inputs.transcript, value.inputs.selectedSummary].some(
      (v) => v === true
    )
  )
    throw new Error(
      'Enter a recipe name and prompt, select at least one input, and choose a supported output and model policy.'
    )
  return {
    name: value.name.trim(),
    prompt: value.prompt,
    scope: value.scope,
    outputKind: value.outputKind,
    policy: value.policy,
    inputs: {
      personalNotes: value.inputs.personalNotes,
      transcript: value.inputs.transcript,
      selectedSummary: value.inputs.selectedSummary
    }
  }
}
/** Separate from meeting originals and sync. Synchronous atomic writes serialize this main-process owner. */
export class RecipeStore {
  constructor(private readonly root: string) {}
  private get file(): string {
    return join(this.root, 'recipes-v1.json')
  }
  read(): RecipeFile {
    try {
      const data: RecipeFile = JSON.parse(readFileSync(this.file, 'utf8'))
      if (data.format !== 1 || !Array.isArray(data.versions) || !Array.isArray(data.outputs))
        throw new Error('Unsupported recipes file')
      for (const v of data.versions) {
        validateRecipe(v)
        if (!v.versionId || !v.recipeId || !Number.isSafeInteger(v.version) || v.version < 1)
          throw new Error('Invalid recipe version')
      }
      for (const o of data.outputs)
        if (!o.runId || !o.meetingId || typeof o.markdown !== 'string' || !o.source || !o.recipe)
          throw new Error('Invalid recipe output')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { format: 1, versions: [], outputs: [] }
      throw new Error(
        'Recipes could not be read. Restore recipes-v1.json from a backup; existing files were not replaced.',
        { cause: error }
      )
    }
  }
  private write(data: RecipeFile): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, JSON.stringify(data, null, 2) + '\n')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, this.file)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  save(draft: RecipeDraft, parentVersionId?: string, duplicate = false): RecipeVersion {
    const valid = validateRecipe(draft)
    const data = this.read()
    const parent = parentVersionId
      ? data.versions.find((v) => v.versionId === parentVersionId)
      : undefined
    if (parentVersionId && !parent)
      throw new Error('That recipe version is unavailable. Reload recipes.')
    const recipeId = parent && !duplicate ? parent.recipeId : randomUUID()
    const version: RecipeVersion = {
      ...valid,
      recipeId,
      versionId: randomUUID(),
      version:
        Math.max(0, ...data.versions.filter((v) => v.recipeId === recipeId).map((v) => v.version)) +
        1,
      createdAt: new Date().toISOString(),
      ...(parent && duplicate ? { duplicatedFrom: parent.versionId } : {})
    }
    data.versions.push(version)
    this.write(data)
    return version
  }
  complete(output: RecipeOutput): RecipeOutput {
    const data = this.read()
    const previous = data.outputs.find((o) => o.runId === output.runId)
    if (previous) {
      if (
        previous.meetingId !== output.meetingId ||
        previous.recipe.versionId !== output.recipe.versionId
      )
        throw new Error('This run ID already belongs to another recipe output.')
      return previous
    }
    data.outputs.push(output)
    this.write(data)
    return output
  }
}
