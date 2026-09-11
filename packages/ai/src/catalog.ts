import os from 'node:os'

/**
 * The curated local-model catalog shown during onboarding (FluidVoice-style:
 * friendly name, size, RAM fit). URIs are node-llama-cpp `hf:` references;
 * the runtime downloads the GGUF with progress on first activation.
 */
export interface LocalModelSpec {
  id: string
  label: string
  description: string
  /** Approximate download size, GiB. */
  sizeGB: number
  /** Minimum total machine RAM to offer this model. */
  minRamGB: number
  uri: string
  /** Publisher LFS identity; validates the exact model/revision/quantization offline. */
  artifact: { bytes: number; sha256: string; uri: string }
}

// URIs verified against the HF API 2026-07-04 (repo exists + Q4_K_M file present).
// All are non-thinking instruct models so notes stay free of reasoning tags.
export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: 'qwen3-4b-instruct',
    label: 'Fast',
    description: 'Qwen3 4B — quick notes on everyday hardware',
    sizeGB: 2.4,
    minRamGB: 8,
    uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M',
    artifact: {
      bytes: 2497281120,
      sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
      uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf#a06e946bb6b655725eafa393f4a9745d460374c9'
    }
  },
  {
    id: 'llama-3.1-8b-instruct',
    label: 'Balanced',
    description: 'Llama 3.1 8B — better structure and fidelity, needs 16GB RAM',
    sizeGB: 4.9,
    minRamGB: 16,
    uri: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M',
    artifact: {
      bytes: 4920739232,
      sha256: '7b064f5842bf9532c91456deda288a1b672397a54fa729aa665952863033557c',
      uri: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf#bf5b95e96dac0462e2a09145ec66cae9a3f12067'
    }
  },
  {
    id: 'gemma-3-12b-it',
    label: 'Quality',
    description: 'Gemma 3 12B — best local notes, needs 24GB RAM',
    sizeGB: 7.3,
    minRamGB: 24,
    uri: 'hf:unsloth/gemma-3-12b-it-GGUF:Q4_K_M',
    artifact: {
      bytes: 7300778336,
      sha256: '15b8fd9d8672cd4240c178c217ca781409291f34e353d2e913b29c7602ceb3ff',
      uri: 'hf:unsloth/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf#d15e4c7dc21dc55d56bf8549db57a71ad8a2a35d'
    }
  }
]

export function totalRamGB(): number {
  return Math.round(os.totalmem() / 1024 ** 3)
}

/** Models this machine can actually run. */
export function availableLocalModels(ramGB = totalRamGB()): LocalModelSpec[] {
  return LOCAL_MODELS.filter((m) => m.minRamGB <= ramGB)
}

/** Onboarding default: the best model that comfortably fits this machine. */
export function defaultLocalModel(ramGB = totalRamGB()): LocalModelSpec {
  const usable = availableLocalModels(ramGB)
  return usable[usable.length - 1] ?? LOCAL_MODELS[0]!
}
