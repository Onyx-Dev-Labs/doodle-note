import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipeScope } from '../shared/recipes-api'

export const recipeDigest = (text: string): string =>
  createHash('sha256').update(text).digest('hex')
export const sameRecipeScope = (a: RecipeScope, b: RecipeScope): boolean =>
  a.libraryId === b.libraryId && a.accountId === b.accountId && a.workspaceId === b.workspaceId

/** Read-only DEV-506 compatibility adapter. Replace with localSourceScope after PR223 integration.
 * Never creates a second identity. Exact legacy/marker semantics are covered by fixtures. */
export function recipeLibrary(root: string): { path: string; scope: RecipeScope } {
  const path = realpathSync(root)
  const meetingsDir = realpathSync(join(path, 'meetings'))
  let libraryId: string
  try {
    const marker: unknown = JSON.parse(
      readFileSync(join(meetingsDir, '.doodlenote-source-library.json'), 'utf8')
    )
    if (
      !marker ||
      typeof marker !== 'object' ||
      !('version' in marker) ||
      marker.version !== 1 ||
      !('libraryId' in marker) ||
      typeof marker.libraryId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(marker.libraryId)
    )
      throw new Error(
        'Invalid source library identity. Restore the library identity before running a recipe.'
      )
    libraryId = marker.libraryId
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    libraryId = `legacy-${recipeDigest(meetingsDir)}`
  }
  return { path, scope: { libraryId, accountId: null, workspaceId: null } }
}
