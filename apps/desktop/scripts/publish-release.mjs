// Upload the packaged update artifacts to the Blob-hosted feed.
// Requires BLOB_READ_WRITE_TOKEN (repo-root .env.local has it in dev).
import { put } from '@vercel/blob'
import { copyFileSync, createReadStream, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

// Publishes release artifacts from release/: mac (latest-mac.yml + ZIP
// updater + DMG website installer)
// and/or windows (latest.yml + exe + blockmap). Pass --mac / --win to limit
// the upload to one platform; default is both. --dmg-only backfills the
// website installer without replacing an already-live updater ZIP/manifest.
const flags = process.argv.slice(2)
const dmgOnly = flags.includes('--dmg-only')
const wantMac = dmgOnly || flags.includes('--mac') || !flags.includes('--win')
const wantWin = !dmgOnly && (flags.includes('--win') || !flags.includes('--mac'))
// Only the CURRENT version's artifacts upload — older ones are already on
// the feed and immutable. (Re-uploading history burned ~600MB per release
// and tripped a stream-reuse bug in the upload client's retry path.)
const { version } = JSON.parse(
  readFileSync(path.join(here, '..', 'package.json'), 'utf8')
)
const isDmgArtifact = (name) => name.endsWith('.dmg') && name.includes(version)
const isMacArtifact = (name) =>
  name === 'latest-mac.yml' ||
  ((name.endsWith('.zip') || name.endsWith('.dmg')) &&
    name.includes(version) &&
    (name.endsWith('.dmg') || name.includes('mac')))
const isWinArtifact = (name) =>
  name === 'latest.yml' ||
  ((name.endsWith('.exe') || name.endsWith('.exe.blockmap')) && name.includes(version))
const artifacts = readdirSync(releaseDir).filter((name) => {
  if (dmgOnly) return isDmgArtifact(name)
  return (wantMac && isMacArtifact(name)) || (wantWin && isWinArtifact(name))
})
if (dmgOnly && artifacts.length === 0) {
  console.error('no version-matched DMG found — run pnpm package first')
  process.exit(1)
}
if (!dmgOnly && !artifacts.includes('latest-mac.yml') && !artifacts.includes('latest.yml')) {
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
// Manifests also become static files on the app domain (committed with the
// release PR): doodle-note.vercel.app/updates/latest*.yml never depends on
// the blob domain, which platform bot-challenges have taken hostage before.
const webUpdatesDir = path.join(here, '..', '..', 'web', 'public', 'updates')
mkdirSync(webUpdatesDir, { recursive: true })
for (const name of artifacts.filter((n) => n.endsWith('.yml'))) {
  copyFileSync(path.join(releaseDir, name), path.join(webUpdatesDir, name))
  console.log(`staged ${name} -> apps/web/public/updates (commit with the release PR)`)
}
console.log('feed published')
