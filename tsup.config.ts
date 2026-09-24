import { defineConfig } from 'tsup'

// Server bundle: our code (server + shared) is bundled; every npm dependency
// stays external and is installed in the runtime image (sharp, argon2 and
// pdfkit ship native binaries / data files that must not be bundled).
export default defineConfig({
  entry: { index: 'server/index.ts', cli: 'server/cli.ts' },
  outDir: 'dist-server',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  tsconfig: 'server/tsconfig.json',
  skipNodeModulesBundle: true,
})
