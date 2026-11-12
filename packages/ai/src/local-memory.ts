import { stat } from 'node:fs/promises'
import { loadNodeLlamaCpp } from './local-engine'

// Capture/ASR is already running when sampled. Leave 1 GiB for its growth,
// native compute buffers and OS activity, beyond fully resident weights + f16 KV.
export const NOTES_WARM_HEADROOM_BYTES = 1024 ** 3

export async function estimateNotesWarmupBytes(
  modelPath: string,
  contextSize: number
): Promise<number | null> {
  const { readGgufFileInfo } = await loadNodeLlamaCpp()
  const [file, info] = await Promise.all([stat(modelPath), readGgufFileInfo(modelPath)])
  const m = info.architectureMetadata
  const layers = m?.block_count
  const heads = m?.attention?.head_count
  const kvHeads = m?.attention?.head_count_kv ?? heads
  const key = m?.attention?.key_length ?? Number(m?.embedding_length) / Number(heads)
  const value = m?.attention?.value_length ?? Number(m?.embedding_length) / Number(heads)
  // Unknown/recurrent architectures must not get an optimistic capture-time estimate.
  if (
    !['qwen3', 'llama', 'gemma3'].includes(String(info.metadata.general?.architecture)) ||
    ![file.size, layers, heads, kvHeads, key, value, contextSize].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
    )
  )
    return null
  // Full-context cache for every layer also conservatively covers Gemma SWA.
  return (
    file.size +
    2 * Number(layers) * Number(kvHeads) * (key + value) * contextSize +
    NOTES_WARM_HEADROOM_BYTES
  )
}
