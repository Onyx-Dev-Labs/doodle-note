/** Types for authenticode-digest.mjs (the single digest implementation). */
export interface PeLayout {
  checksumOffset: number
  secEntry: number
  sizeOfHeaders: number
  /** Sections with raw data, sorted by file offset, back to back after the headers. */
  sections: Array<{ pointer: number; size: number }>
  /** End of the last section's raw data (or of the headers). */
  sectionsEnd: number
  table: { va: number; size: number } | null
}
export function peLayout(buffer: Buffer): PeLayout | null
export function stableDigest(buffer: Buffer): string | null
