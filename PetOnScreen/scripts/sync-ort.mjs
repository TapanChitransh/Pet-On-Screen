// Copies the onnxruntime WebAssembly runtime that transformers.js needs into the renderer's public
// folder, so voice recognition loads it from the app bundle instead of a CDN. Runs before dev/build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', '@huggingface', 'transformers', 'dist')
const dst = join(root, 'src', 'renderer', 'public', 'ort')
mkdirSync(dst, { recursive: true })
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  const from = join(src, file)
  if (!existsSync(from)) {
    console.error(`[sync-ort] ${from} is missing. Run npm install first.`)
    process.exit(1)
  }
  copyFileSync(from, join(dst, file))
}
console.log('[sync-ort] onnxruntime wasm copied to src/renderer/public/ort')
