import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { localSourceScope, sameScope } from '@repo/meetings-store/sources'
import type { RecipeScope } from '../shared/recipes-api'

export const recipeDigest = (text: string): string =>
  createHash('sha256').update(text).digest('hex')
export const sameRecipeScope = sameScope

/** Share the index/MCP identity without creating a marker; the canonical path is a separate fence. */
export function recipeLibrary(root: string): { path: string; scope: RecipeScope } {
  const path = realpathSync(root)
  const meetingsDir = realpathSync(join(path, 'meetings'))
  return { path, scope: localSourceScope(meetingsDir, false) }
}
