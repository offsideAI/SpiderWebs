import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Keep all dependencies external (incl. workspace packages). The CLI runs from
  // the installed workspace and resolves them at runtime, avoiding bundling
  // CJS-only transitive deps (e.g. simple-git) into an ESM bundle. A self-
  // contained single-file binary is a separate packaging step (M6).
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
