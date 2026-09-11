import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@models': resolve('src/models'),
      '@engine': resolve('src/engine'),
      '@services': resolve('src/services')
    }
  },
  test: { include: ['tests/**/*.test.ts'] }
})
