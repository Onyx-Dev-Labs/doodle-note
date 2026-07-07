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
    uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M'
  },
  {
    id: 'llama-3.1-8b-instruct',
    label: 'Balanced',
    description: 'Llama 3.1 8B — better structure and fidelity, needs 16GB RAM',
    sizeGB: 4.9,
    minRamGB: 16,
    uri: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M'
  },
  {
    id: 'gemma-3-12b-it',
    label: 'Quality',
    description: 'Gemma 3 12B — best local notes, needs 24GB RAM',
    sizeGB: 7.3,
    minRamGB: 24,
    uri: 'hf:unsloth/gemma-3-12b-it-GGUF:Q4_K_M'
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
