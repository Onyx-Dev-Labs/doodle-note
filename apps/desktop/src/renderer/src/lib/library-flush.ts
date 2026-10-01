const saves = new Set<() => Promise<void>>()
export function registerLibrarySave(save: () => Promise<void>): () => void {
  saves.add(save)
  return () => {
    saves.delete(save)
  }
}
export async function flushLibrarySaves(): Promise<void> {
  await Promise.all([...saves].map((save) => save()))
}
