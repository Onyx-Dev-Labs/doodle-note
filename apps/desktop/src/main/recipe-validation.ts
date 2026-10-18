import type {
  RecipeDraft,
  RecipeOutput,
  RecipeRun,
  RecipeScope,
  RecipeVersion
} from '../shared/recipes-api'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value)
export const validRecipeMeetingId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(value)
const timestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}
const inputKeys = ['personalNotes', 'transcript', 'selectedSummary'] as const

export function validRecipeScope(value: unknown): value is RecipeScope & Record<string, unknown> {
  return (
    object(value) &&
    text(value.libraryId) &&
    (value.accountId === null || text(value.accountId)) &&
    (value.workspaceId === null || text(value.workspaceId))
  )
}
export function validRecipeIdentity(
  value: unknown
): value is { meetingId: string; runId: string } & Record<string, unknown> {
  return object(value) && validRecipeMeetingId(value.meetingId) && id(value.runId)
}
/** IPC types are not runtime validation. Validate before reserving a job or entering the library. */
export function assertRecipeRun(value: unknown): asserts value is RecipeRun {
  if (
    !object(value) ||
    !validRecipeIdentity(value) ||
    !id(value.versionId) ||
    !validRecipeScope(value.library) ||
    (value.cloudConfirmed !== undefined && typeof value.cloudConfirmed !== 'boolean')
  )
    throw new Error(
      'A valid recipe run needs meeting, version and run IDs, a current library scope, and boolean confirmation when supplied.'
    )
}
export function validRecipeDraft(value: unknown): value is RecipeDraft {
  if (
    !object(value) ||
    !text(value.name) ||
    value.name.length > 120 ||
    !text(value.prompt) ||
    value.prompt.length > 100_000 ||
    value.scope !== 'current-meeting' ||
    typeof value.outputKind !== 'string' ||
    !['markdown', 'checklist', 'email-draft'].includes(value.outputKind) ||
    typeof value.policy !== 'string' ||
    !['local-only', 'explicit-cloud'].includes(value.policy) ||
    !object(value.inputs)
  )
    return false
  const inputs = value.inputs
  return (
    inputKeys.every((key) => typeof inputs[key] === 'boolean') &&
    inputKeys.some((key) => inputs[key] === true)
  )
}
function validVersion(value: unknown): value is RecipeVersion {
  return (
    object(value) &&
    validRecipeDraft(value) &&
    id(value.recipeId) &&
    id(value.versionId) &&
    typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) &&
    value.version > 0 &&
    timestamp(value.createdAt) &&
    (value.duplicatedFrom === undefined || id(value.duplicatedFrom))
  )
}
export function assertRecipeOutput(value: unknown): asserts value is RecipeOutput {
  if (
    !object(value) ||
    !validRecipeIdentity(value) ||
    !validVersion(value.recipe) ||
    !object(value.source) ||
    !validRecipeScope(value.source) ||
    typeof value.source.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.source.revision) ||
    !timestamp(value.source.capturedAt) ||
    !Array.isArray(value.source.inputKinds) ||
    !object(value.model) ||
    !text(value.model.id) ||
    !text(value.model.revision) ||
    !timestamp(value.startedAt) ||
    !timestamp(value.completedAt) ||
    typeof value.markdown !== 'string'
  )
    throw new Error('Invalid recipe output metadata. No output was saved.')
  const recipe = value.recipe
  const kinds = value.source.inputKinds
  const selected = inputKeys.filter((key) => recipe.inputs[key])
  if (kinds.length !== selected.length || !selected.every((key) => kinds.includes(key)))
    throw new Error('Invalid recipe output inputs. No output was saved.')
}
export interface RecipeFile {
  format: 1
  versions: RecipeVersion[]
  outputs: RecipeOutput[]
  [key: string]: unknown
}
/** Validate in place: unknown richer fields must survive; malformed originals must not be repaired. */
export function assertRecipeFile(value: unknown): asserts value is RecipeFile {
  if (
    !object(value) ||
    value.format !== 1 ||
    !Array.isArray(value.versions) ||
    !Array.isArray(value.outputs)
  )
    throw new Error('Invalid recipe file format')
  for (const version of value.versions)
    if (!validVersion(version)) throw new Error('Invalid recipe version metadata')
  for (const output of value.outputs) assertRecipeOutput(output)
  if (
    new Set(value.versions.map((version) => version.versionId)).size !== value.versions.length ||
    new Set(value.outputs.map((output) => output.runId)).size !== value.outputs.length
  )
    throw new Error('Invalid recipe file: duplicate version or run IDs')
}
