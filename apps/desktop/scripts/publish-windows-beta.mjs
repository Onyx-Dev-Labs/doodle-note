// Publish a manually tested Windows beta without changing latest.yml, which is
// the production electron-updater feed. Production Windows releases must keep
// using `pnpm release:win`, including its Authenticode verification gate.
import { put } from '@vercel/blob'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWindowsBetaManifests } from './windows-beta-manifest.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.join(here, '..')
const releaseDir = process.env.WINDOWS_RELEASE_DIR ?? path.join(desktopDir, 'release')

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  const envLocal =
    process.env.BLOB_ENV_FILE ?? path.join(desktopDir, '..', '..', '.env.local')
  try {
    const text = readFileSync(envLocal, 'utf8')
    const match = text.match(/^BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?$/m)
    if (match) process.env.BLOB_READ_WRITE_TOKEN = match[1]
  } catch {
    // Fall through to the actionable error below.
  }
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error(
    'BLOB_READ_WRITE_TOKEN not set (vercel env pull refreshes .env.local; BLOB_ENV_FILE can select another env file)'
  )
}

const { version } = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8'))
const manifestPath = path.join(releaseDir, 'latest.yml')
const manifest = readFileSync(manifestPath, 'utf8')
const manifestVersion = /^version:\s*["']?([^\s"']+)["']?\s*$/m.exec(manifest)?.[1]
const installerName = /^path:\s*(\S+)\s*$/m.exec(manifest)?.[1]

if (manifestVersion !== version) {
  throw new Error(`Windows manifest version ${manifestVersion ?? 'missing'} does not match ${version}`)
}
if (!installerName || !installerName.endsWith('-setup.exe')) {
  throw new Error('Windows manifest does not contain a valid setup.exe path')
}

// Keep beta filenames distinct so a later signed production build at the same
// version can never be overwritten by an unsigned tester artifact.
const betaInstallerName = installerName.replace(/-setup\.exe$/, '-beta-setup.exe')
const artifacts = [
  { source: installerName, destination: betaInstallerName },
  { source: `${installerName}.blockmap`, destination: `${betaInstallerName}.blockmap` }
]
for (const { source, destination } of artifacts) {
  const file = path.join(releaseDir, source)
  const size = statSync(file).size
  process.stdout.write(`uploading beta ${destination} (${(size / 1024 / 1024).toFixed(1)} MB)… `)
  const blob = await put(`updates/${destination}`, createReadStream(file), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true
  })
  console.log(blob.url)
}

for (const { pathname, body } of buildWindowsBetaManifests(manifest, installerName)) {
  process.stdout.write(`uploading beta manifest ${pathname}… `)
  const betaManifest = await put(pathname, Buffer.from(body), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60
  })
  console.log(betaManifest.url)
}
console.log('production latest.yml remains unchanged')
