// Windows icons from the existing artwork. Run from any directory after pnpm install;
// reuses the locked sharp toolchain (like build-tray-assets.cjs) on macOS or Windows.
//
//   resources/icon.ico               app/installer icon, 16–256 px
//   resources/tray/dogWin.ico        notification-area dog, 16–48 px
//   resources/tray/dogWinRecording.ico  same dog with red eyes and a red recording dot
//
// ICO entries below 256 px are 32-bit BMPs (with an AND mask) for the widest
// compatibility (Explorer, the taskbar, NSIS, rcedit); 256 px is PNG-compressed.
const fs = require('node:fs')
const path = require('node:path')
const modules = path.resolve(__dirname, '../../../node_modules/.pnpm')
const sharpDir = fs.readdirSync(modules).find((name) => name.startsWith('sharp@'))
if (!sharpDir) throw new Error('Run pnpm install --frozen-lockfile first')
const sharp = require(path.join(modules, sharpDir, 'node_modules/sharp'))
const resources = path.resolve(__dirname, '../resources')

const APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const TRAY_SIZES = [16, 20, 24, 32, 40, 48]

/** Raw RGBA pixels for one square size. */
async function rgba(input, size) {
  const { data } = await sharp(input)
    .resize(size, size, { kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return data
}

/** BITMAPINFOHEADER + bottom-up BGRA rows + 1-bit AND mask. */
function bmpEntry(pixels, size) {
  const maskStride = Math.ceil(size / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // XOR image + AND mask
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20)
  const xor = Buffer.alloc(size * size * 4)
  const mask = Buffer.alloc(maskStride * size)
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4
      const to = (row * size + x) * 4
      xor[to] = pixels[from + 2]
      xor[to + 1] = pixels[from + 1]
      xor[to + 2] = pixels[from]
      xor[to + 3] = pixels[from + 3]
      if (pixels[from + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, xor, mask])
}

async function writeIco(input, sizes, output) {
  const images = []
  for (const size of sizes) {
    images.push({
      size,
      data:
        size >= 256
          ? await sharp(input).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
          : bmpEntry(await rgba(input, size), size)
    })
  }
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt8(0, entry + 2)
    header.writeUInt8(0, entry + 3)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(data.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  fs.writeFileSync(output, Buffer.concat([header, ...images.map((image) => image.data)]))
  console.log(`wrote ${path.relative(process.cwd(), output)} (${sizes.join(', ')})`)
}

/** The tray dog for Windows: a white body with a dark edge reads on light and
 * dark taskbars alike; recording adds red eyes and a red dot. */
function trayDog(recording) {
  let svg = fs.readFileSync(path.join(resources, 'tray', 'dog.svg'), 'utf8')
  svg = svg.replace('color="#000"', 'color="#fff"')
  svg = svg.replace(
    '<use href="#dog"',
    '<use href="#dog" fill="none" stroke="#1d1f19" stroke-width="2" stroke-linejoin="round"/><use href="#dog"'
  )
  // Fill the face (transparent in the macOS template) so it reads on a light taskbar too.
  svg = svg.replace(
    '</svg>',
    recording
      ? '<use href="#features" color="#ff3b30"/><circle cx="19" cy="19" r="4.6" fill="#ff3b30" stroke="#fff" stroke-width="1.4"/></svg>'
      : '<use href="#features" color="#1d1f19"/></svg>'
  )
  return Buffer.from(svg)
}

async function main() {
  await writeIco(
    path.join(resources, 'icon-master.png'),
    APP_SIZES,
    path.join(resources, 'icon.ico')
  )
  // Render the vector once at high resolution so every size downsamples cleanly.
  for (const [name, recording] of [
    ['dogWin.ico', false],
    ['dogWinRecording.ico', true]
  ]) {
    const master = await sharp(trayDog(recording), { density: 1152 })
      .resize(256, 256)
      .png()
      .toBuffer()
    await writeIco(master, TRAY_SIZES, path.join(resources, 'tray', name))
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
