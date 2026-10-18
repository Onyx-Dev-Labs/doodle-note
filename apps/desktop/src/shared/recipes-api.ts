export interface RecipeScope {
  libraryId: string
  accountId: string | null
  workspaceId: string | null
}
export interface RecipeDraft {
  name: string
  prompt: string
  scope: 'current-meeting'
  outputKind: 'markdown' | 'checklist' | 'email-draft'
  policy: 'local-only' | 'explicit-cloud'
  inputs: { personalNotes: boolean; transcript: boolean; selectedSummary: boolean }
}
export interface RecipeVersion extends RecipeDraft {
  recipeId: string
  versionId: string
  version: number
  createdAt: string
  duplicatedFrom?: string
}
export interface RecipeOutput {
  runId: string
  meetingId: string
  recipe: RecipeVersion
  source: RecipeScope & { revision: string; capturedAt: string; inputKinds: string[] }
  model: { id: string; revision: string }
  startedAt: string
  completedAt: string
  markdown: string
}
export interface RecipeList {
  scope: RecipeScope
  versions: RecipeVersion[]
  outputs: RecipeOutput[]
}
export interface RecipeRun {
  meetingId: string
  runId: string
  versionId: string
  library: RecipeScope
  /** Explicit user confirmation for this run, not inferred from source metadata. */
  cloudConfirmed?: boolean
}
export type RecipeResult<T> = { value: T; error?: never } | { error: string; value?: never }
export interface RecipesApi {
  list(meetingId: string): Promise<RecipeResult<RecipeList>>
  save(
    library: RecipeScope,
    draft: RecipeDraft,
    parentVersionId?: string,
    duplicate?: boolean
  ): Promise<RecipeResult<RecipeVersion>>
  run(request: RecipeRun): Promise<RecipeResult<RecipeOutput>>
  cancel(identity: { meetingId: string; runId: string }): Promise<boolean>
}
export const RECIPE_CHANNELS = {
  list: 'recipes:list',
  save: 'recipes:save',
  run: 'recipes:run',
  cancel: 'recipes:cancel'
} as const
