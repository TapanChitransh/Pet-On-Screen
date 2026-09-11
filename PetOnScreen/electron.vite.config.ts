import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const aliases = {
  '@shared': resolve('src/shared'),
  '@models': resolve('src/models'),
  '@engine': resolve('src/engine'),
  '@services': resolve('src/services'),
  '@renderer': resolve('src/renderer/src')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases }
  },
  renderer: {
    resolve: { alias: aliases },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          pet: resolve('src/renderer/index.html'),
          dashboard: resolve('src/renderer/dashboard.html')
        }
      }
    }
  }
})
