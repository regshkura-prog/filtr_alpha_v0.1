// Builds every app icon from media/fader-icon.png (1024x1024 RGBA):
// build/icon.ico (Windows, installer), build/icon.icns (macOS), build/icon.png (Linux),
// resources/icon.png (window and drag icon), src/renderer/src/assets/filtr.png (header).
// Run: npm run icons
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'media', 'fader-icon.png')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// PNG-backed icns entries; the @2x types reuse the bigger renders.
const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512]
]

function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

const work = mkdtempSync(join(tmpdir(), 'filtr-icons-'))
try {
  const master = readFileSync(source)
  const { width, height } = pngSize(master)
  if (width !== 1024 || height !== 1024) throw new Error(`Нужен PNG 1024x1024, а не ${width}x${height}`)

  const sizes = [...new Set([...ICO_SIZES, ...ICNS_TYPES.map(([, size]) => size)])]
  const renders = new Map()
  for (const size of sizes) {
    if (size === 1024) {
      renders.set(size, master)
      continue
    }
    const out = join(work, `${size}.png`)
    execFileSync(ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-vf',
      `scale=${size}:${size}:flags=lanczos`,
      '-pix_fmt',
      'rgba',
      out
    ])
    renders.set(size, readFileSync(out))
  }

  // ICO with PNG payloads: 6-byte header, 16-byte directory entry per image, then the data.
  const icoImages = ICO_SIZES.map((size) => renders.get(size))
  const ico = Buffer.alloc(6 + 16 * icoImages.length)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(icoImages.length, 4)
  let offset = ico.length
  ICO_SIZES.forEach((size, index) => {
    const entry = 6 + index * 16
    ico.writeUInt8(size >= 256 ? 0 : size, entry)
    ico.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    ico.writeUInt16LE(1, entry + 4)
    ico.writeUInt16LE(32, entry + 6)
    ico.writeUInt32LE(icoImages[index].length, entry + 8)
    ico.writeUInt32LE(offset, entry + 12)
    offset += icoImages[index].length
  })
  writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([ico, ...icoImages]))

  // ICNS: "icns" + total length, then type + length (header included) + PNG per entry.
  const entries = ICNS_TYPES.map(([type, size]) => {
    const png = renders.get(size)
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const icnsHeader = Buffer.alloc(8)
  icnsHeader.write('icns', 0, 'ascii')
  icnsHeader.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4)
  writeFileSync(join(root, 'build', 'icon.icns'), Buffer.concat([icnsHeader, ...entries]))

  copyFileSync(source, join(root, 'build', 'icon.png'))
  writeFileSync(join(root, 'resources', 'icon.png'), renders.get(256))
  writeFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'filtr.png'), renders.get(256))
  console.log('Иконки обновлены: build/icon.{ico,icns,png}, resources/icon.png, assets/filtr.png')
} finally {
  rmSync(work, { recursive: true, force: true })
}
