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

import {
  assertRecipeFile,
  assertRecipeOutput,
  validRecipeDraft,
  type RecipeFile
} from './recipe-validation'

export function validateRecipe(value: unknown): RecipeDraft {
  if (!validRecipeDraft(value))
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
      const data: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      assertRecipeFile(data)
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
    assertRecipeFile(data)
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
    assertRecipeOutput(output)
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
