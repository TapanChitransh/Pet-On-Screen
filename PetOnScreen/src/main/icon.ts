import { nativeImage, type NativeImage } from 'electron'
import { deflateSync } from 'zlib'

/** Minimal PNG encoder so we can ship a tray icon without binary assets. */
function crc32(buf: Buffer): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(size: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * A little paw print. On macOS the menu bar expects a black "template" image that the system tints
 * for light/dark menu bars; elsewhere we draw it orange.
 */
export function createTrayIcon(size = 32): NativeImage {
  const mac = process.platform === 'darwin'
  const color: [number, number, number] = mac ? [0, 0, 0] : [255, 140, 66]
  const circles: [number, number, number][] = [
    [0.5, 0.66, 0.24], // pad
    [0.27, 0.36, 0.11],
    [0.45, 0.24, 0.11],
    [0.65, 0.26, 0.11],
    [0.8, 0.43, 0.1]
  ]
  const png = encodePng(size, (x, y) => {
    const px = (x + 0.5) / size
    const py = (y + 0.5) / size
    let inside = false
    for (const [cx, cy, r] of circles) {
      const d = Math.hypot(px - cx, py - cy * 1.05)
      if (d < r) inside = true
    }
    return inside ? [color[0], color[1], color[2], 255] : [0, 0, 0, 0]
  })
  if (mac) {
    // 16pt menu bar icon supplied at 2x for Retina, marked as a template so macOS tints it.
    const image = nativeImage.createFromBuffer(png, { width: size, height: size, scaleFactor: 2 })
    image.setTemplateImage(true)
    return image
  }
  return nativeImage.createFromBuffer(png, { width: size, height: size })
}
