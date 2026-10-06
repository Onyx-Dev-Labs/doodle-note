import { openAsBlob } from 'node:fs'

// A ReadStream is consumed by the first upload attempt. A disk-backed Blob can
// be read again by the SDK retry without buffering the entire installer in RAM.
export async function windowsReleaseBody(file) {
  return openAsBlob(file)
}
