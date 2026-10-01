import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Never infer speakers from arbitrary stereo. Old native checkpoints prove
 * capture origin; unknown or damaged metadata falls back to preserving all
 * audio in one neutral-speaker mix, without modifying the stored recording. */
export function batchChannelsForPart(directory: string): 'mixed' | 'split' {
  try {
    const meta = JSON.parse(readFileSync(join(directory, 'part.json'), 'utf8'))
    if (meta.channels === 'mixed' || meta.channels === 'split') return meta.channels
  } catch {
    /* Legacy or unavailable metadata. */
  }
  return existsSync(join(directory, 'checkpoints')) ? 'split' : 'mixed'
}
