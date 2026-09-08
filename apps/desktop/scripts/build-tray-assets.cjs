// Run from any directory after pnpm install. Reuses the locked sharp toolchain.
const fs = require('node:fs')
const path = require('node:path')
const modules = path.resolve(__dirname, '../../../node_modules/.pnpm')
const sharpDir = fs.readdirSync(modules).find((name) => name.startsWith('sharp@'))
if (!sharpDir) throw new Error('Run pnpm install --frozen-lockfile first')
const sharp = require(path.join(modules, sharpDir, 'node_modules/sharp'))
const resources = path.resolve(__dirname, '../resources/tray')
const source = fs.readFileSync(path.join(resources, 'dog.svg'), 'utf8')
async function main() {
  for (const [name, color, halo] of [
    ['dogTemplate', '#000', null],
    ['dogRecordingLight', '#111', '#fff'],
    ['dogRecordingDark', '#fff', '#111']
  ]) {
    let svg = source.replace('color="#000"', `color="${color}"`)
    if (halo) {
      // A thin contrasting edge keeps the non-template dog legible over wallpaper.
      svg = svg.replace(
        '<use href="#dog"',
        `<use href="#dog" fill="none" stroke="${halo}" stroke-width="0.8"/><use href="#dog"`
      )
      svg = svg.replace(
        '</svg>',
        `<circle cx="19" cy="5" r="3.5" fill="#ff3b30" stroke="${halo}" stroke-width="1.3"/></svg>`
      )
    }
    for (const [size, density, suffix] of [
      [18, 72, ''],
      [36, 144, '@2x']
    ]) {
      await sharp(Buffer.from(svg))
        .resize(size, size)
        .withMetadata({ density })
        .png()
        .toFile(path.join(resources, `${name}${suffix}.png`))
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
