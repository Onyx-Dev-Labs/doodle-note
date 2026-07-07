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

// Publishes update artifacts from release/: mac (latest-mac.yml + zips)
// and/or windows (latest.yml + exe + blockmap). Pass --mac / --win to limit
// the upload to one platform; default is both.
const flags = process.argv.slice(2)
const wantMac = flags.includes('--mac') || !flags.includes('--win')
const wantWin = flags.includes('--win') || !flags.includes('--mac')
const isMacArtifact = (name) =>
  name === 'latest-mac.yml' || (name.endsWith('.zip') && name.includes('mac'))
const isWinArtifact = (name) =>
  name === 'latest.yml' || name.endsWith('.exe') || name.endsWith('.exe.blockmap')
const artifacts = readdirSync(releaseDir).filter(
  (name) => (wantMac && isMacArtifact(name)) || (wantWin && isWinArtifact(name))
)
if (!artifacts.includes('latest-mac.yml') && !artifacts.includes('latest.yml')) {
  console.error('no update manifest found — run pnpm package (mac) or package:win first')
  process.exit(1)
}

for (const name of artifacts) {
  const file = path.join(releaseDir, name)
  const size = statSync(file).size
  process.stdout.write(`uploading ${name} (${(size / 1024 / 1024).toFixed(1)} MB)… `)
  // Manifests (latest*.yml) get a short CDN TTL — the default is 30 days,
  // which froze the feed and made "Check for updates" report stale versions.
  // Versioned artifacts are immutable, so the long default is fine there.
  const isManifest = name.endsWith('.yml')
  const blob = await put(`updates/${name}`, createReadStream(file), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    ...(isManifest ? { cacheControlMaxAge: 60 } : {})
  })
  console.log(blob.url)
}
console.log('feed published')
