// Upload the packaged update artifacts to the Blob-hosted feed.
// Requires BLOB_READ_WRITE_TOKEN (repo-root .env.local has it in dev).
import { put } from '@vercel/blob'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const releaseDir = path.join(here, '..', 'release')

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  const envLocal = path.join(here, '..', '..', '..', '.env.local')
  try {
    const text = await readFile(envLocal, 'utf8')
    const match = text.match(/^BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?$/m)
    if (match) process.env.BLOB_READ_WRITE_TOKEN = match[1]
  } catch {
    // fall through to the error below
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN not set (vercel env pull refreshes .env.local)')
  process.exit(1)
}

const artifacts = readdirSync(releaseDir).filter(
  (name) => name === 'latest-mac.yml' || (name.endsWith('.zip') && name.includes('mac'))
)
if (!artifacts.includes('latest-mac.yml')) {
  console.error('latest-mac.yml missing — run pnpm package first (zip target enabled?)')
  process.exit(1)
}

for (const name of artifacts) {
  const file = path.join(releaseDir, name)
  const size = statSync(file).size
  process.stdout.write(`uploading ${name} (${(size / 1024 / 1024).toFixed(1)} MB)… `)
  const blob = await put(`updates/${name}`, createReadStream(file), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true
  })
  console.log(blob.url)
}
console.log('feed published')
