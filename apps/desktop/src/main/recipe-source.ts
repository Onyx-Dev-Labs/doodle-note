import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipeVersion, RecipeScope } from '../shared/recipes-api'
import { recipeDigest, sameRecipeScope } from './recipe-library'

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
/** Read authoritative raw JSON, preserving richer fields and failing closed on scope ambiguity. */
export function recipeSource(
  root: string,
  meetingId: string,
  recipe: RecipeVersion,
  scope: RecipeScope
): {
  revision: string
  text: string
  inputKinds: string[]
} {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(meetingId)) throw new Error('Invalid meeting ID.')
  const file = join(root, 'meetings', `${meetingId}.json`)
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    throw new Error('Meeting source is unavailable.')
  const raw = readFileSync(file, 'utf8')
  const doc: unknown = JSON.parse(raw)
  if (!object(doc) || doc.id !== meetingId || doc.trashedAt != null)
    throw new Error('This meeting is unavailable or in Trash.')
  if (doc.sourceScope !== undefined) {
    const owner = doc.sourceScope
    if (
      !object(owner) ||
      typeof owner.libraryId !== 'string' ||
      owner.accountId !== null ||
      owner.workspaceId !== null ||
      !sameRecipeScope(owner as unknown as RecipeScope, scope)
    )
      throw new Error(
        'This meeting belongs to a different or unsupported library scope. Fetches only use this local meeting.'
      )
  }
  // This base has no authoritative per-meeting export authorization API. Neither legacy
  // absence nor a null/null sourceScope proves permission to send shared/imported content.
  if (recipe.policy === 'explicit-cloud')
    throw new Error(
      'Cloud fetches are unavailable for this source because export authorization cannot be verified. Save a local-only version to run on this device.'
    )
  const inputKinds: string[] = []
  const inputs: Record<string, unknown> = {}
  const text = (value: unknown): string => {
    if (value === undefined) return ''
    if (typeof value !== 'string')
      throw new Error('A selected meeting input is invalid. Repair it before retrying.')
    return value
  }
  inputs.title = text(doc.title)
  if (recipe.inputs.personalNotes) {
    inputKinds.push('personalNotes')
    inputs.personalNotes = text(doc.rawNotesMarkdown)
  }
  if (recipe.inputs.transcript) {
    inputKinds.push('transcript')
    if (!Array.isArray(doc.segments)) throw new Error('This meeting transcript is unavailable.')
    if (doc.segments.some((s) => !object(s) || typeof s.text !== 'string'))
      throw new Error('Invalid transcript source.')
    inputs.transcript = doc.segments
      .filter((s) => object(s) && !s.echo)
      .map((s) => {
        if (!object(s)) throw new Error('Invalid transcript source.')
        return {
          id: s.id,
          speaker: Array.isArray(doc.participants)
            ? text(
                doc.participants.find((p) => object(p) && p.id === s.speakerId)?.name ?? s.speaker
              )
            : text(s.speaker),
          speakerId: s.speakerId,
          text: text(s.text),
          startMs: s.startMs,
          endMs: s.endMs
        }
      })
    inputs.participants = doc.participants ?? []
  }
  if (recipe.inputs.selectedSummary) {
    inputKinds.push('selectedSummary')
    const metadata = object(doc.metadata) ? doc.metadata : undefined
    if (metadata?.selectedSummaryID != null) {
      const summary = Array.isArray(metadata.summaries)
        ? metadata.summaries.find((s) => object(s) && s.id === metadata.selectedSummaryID)
        : undefined
      if (!object(summary) || typeof summary.text !== 'string')
        throw new Error(
          'The selected summary is unavailable. Select another input; no older summary was substituted.'
        )
      inputs.selectedSummary = summary.text
      inputs.selectedSummaryID = metadata.selectedSummaryID
    } else inputs.selectedSummary = text(doc.enhancedMarkdown)
  }
  // Entire raw-source hash detects edits to ownership, session, richer revisions and original content.
  return { revision: recipeDigest(raw), text: JSON.stringify(inputs), inputKinds }
}
