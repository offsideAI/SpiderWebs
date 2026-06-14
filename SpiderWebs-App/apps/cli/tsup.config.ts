import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Bundle workspace packages into the CLI; keep registry deps external.
  noExternal: [/^@spiderwebs\//],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
