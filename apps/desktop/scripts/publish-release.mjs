// Mac candidate promotion: see docs/qa/mac-publisher.md. Windows stays legacy.
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishMacRelease } from './publish-mac-release.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const releaseDir = path.join(here, '..', 'release')

async function publishWindows() {
  // Intentionally unchanged legacy Windows upload semantics; not qualified by
  // the Mac publisher's safety tests. No Mac path can enter this function.
  const { put } = await import('@vercel/blob')
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

  const { version } = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
  const isWinArtifact = (name) =>
    name === 'latest.yml' ||
    ((name.endsWith('.exe') || name.endsWith('.exe.blockmap')) && name.includes(version))
  const artifacts = readdirSync(releaseDir).filter(isWinArtifact)
  if (!artifacts.includes('latest.yml')) {
    throw new Error('no update manifest found — run package:win first')
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
}

async function main() {
  const flags = process.argv.slice(2)
  if (flags.length === 1 && flags[0] === '--win') return publishWindows()
  if (flags.includes('--help')) {
    console.log(
      'Usage: publish-release.mjs --mac|--dmg-only --source-sha SHA [--release-dir DIR] [--dry-run] [--activate --rollback-dir DIR]\n       publish-release.mjs --win (legacy Windows workflow)\nMac defaults to payload upload/verification only. --activate publishes Blob feed last and stages the static feed for review. See docs/qa/mac-publisher.md.'
    )
    return
  }
  if (flags.includes('--win') || (!flags.includes('--mac') && !flags.includes('--dmg-only'))) {
    throw new Error(
      'Select --mac or --dmg-only with --source-sha; run --win separately. Combined/default publication is retired. See docs/qa/mac-publisher.md.'
    )
  }
  const options = {}
  const seen = new Set()
  const valued = {
    '--release-dir': 'releaseDir',
    '--source-sha': 'sourceSha',
    '--rollback-dir': 'rollbackDir'
  }
  const switches = new Set(['--mac', '--dmg-only', '--dry-run', '--activate'])
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`)
    seen.add(flag)
    if (valued[flag]) {
      const value = flags[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`)
      options[valued[flag]] = value
    } else if (!switches.has(flag)) {
      throw new Error(`Unknown option: ${flag}`)
    }
  }
  const { version } = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
  const result = await publishMacRelease({
    ...options,
    releaseDir: path.resolve(options.releaseDir ?? releaseDir),
    version,
    dmgOnly: flags.includes('--dmg-only'),
    dryRun: flags.includes('--dry-run'),
    activate: flags.includes('--activate'),
    webUpdatesDir: path.join(here, '..', '..', 'web', 'public', 'updates')
  })
  console.log(JSON.stringify(result, null, 2))
  console.log(
    flags.includes('--dry-run')
      ? 'Local validation only; no network or feed changes.'
      : result.activated
        ? 'Blob feed verified; static Mac manifest staged for review/deployment. Keep rollback records. Public web activation and real updater acceptance still require verification.'
        : 'Payloads verified; no feed activation or web staging.'
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
