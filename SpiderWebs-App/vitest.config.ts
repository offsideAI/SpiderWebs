import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript sources so tests run
    // without a prior build. `pnpm build` still validates the compiled output.
    alias: {
      '@spiderwebs/schema': pkg('schema'),
      '@spiderwebs/config': pkg('config'),
      '@spiderwebs/core': pkg('core'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
    },
  },
});
