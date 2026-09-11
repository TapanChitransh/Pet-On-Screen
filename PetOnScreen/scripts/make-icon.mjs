// Generates build/icon.png (1024x1024) - a rounded orange tile with a white paw print.
// electron-builder converts it to .icns (macOS) and .ico (Windows) at packaging time.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const SIZE = 1024

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

// Signed distance helpers (in 0..1 tile space)
const circle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r
function roundedRect(px, py, half, radius) {
  const qx = Math.abs(px - 0.5) - half + radius
  const qy = Math.abs(py - 0.5) - half + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

const PAW = [
  [0.5, 0.64, 0.19], // main pad
  [0.31, 0.4, 0.095],
  [0.435, 0.3, 0.095],
  [0.585, 0.31, 0.095],
  [0.71, 0.44, 0.09]
]

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
const aa = 1.5 / SIZE
const smooth = (d) => Math.max(0, Math.min(1, 0.5 - d / (2 * aa)))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  for (let x = 0; x < SIZE; x++) {
    const px = (x + 0.5) / SIZE
    const py = (y + 0.5) / SIZE
    // macOS-style tile: 82% of the canvas, big corner radius
    const tile = smooth(roundedRect(px, py, 0.41, 0.09))
    // subtle vertical gradient
    const t = (py - 0.09) / 0.82
    let r = 255 * (1 - t) + 236 * t
    let g = 150 * (1 - t) + 110 * t
    let b = 70 * (1 - t) + 40 * t
    let paw = 0
    for (const [cx, cy, rad] of PAW) paw = Math.max(paw, smooth(circle(px, py, cx, cy, rad)))
    // soft shadow under the paw
    let shadow = 0
    for (const [cx, cy, rad] of PAW) shadow = Math.max(shadow, smooth(circle(px, py + 0.012, cx, cy, rad + 0.01)))
    r = r * (1 - shadow * 0.25)
    g = g * (1 - shadow * 0.25)
    b = b * (1 - shadow * 0.25)
    r = r * (1 - paw) + 255 * paw
    g = g * (1 - paw) + 252 * paw
    b = b * (1 - paw) + 246 * paw
    const o = y * (SIZE * 4 + 1) + 1 + x * 4
    raw[o] = Math.round(r)
    raw[o + 1] = Math.round(g)
    raw[o + 2] = Math.round(b)
    raw[o + 3] = Math.round(255 * tile)
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`wrote build/icon.png (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`)
