import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared'), '@': path.resolve(__dirname, 'src') } },
  test: { include: ['shared/**/*.test.ts', 'server/**/*.test.ts'], environment: 'node' },
})
