import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Ink TUI components are .tsx; Vitest's oxc transform defaults to React's
  // automatic JSX runtime (React 19), so no explicit jsx config is needed.
  resolve: {
    // Resolve workspace packages to their TypeScript sources so tests run
    // without a prior build. `pnpm build` still validates the compiled output.
    alias: {
      '@spiderwebs/schema': pkg('schema'),
      '@spiderwebs/config': pkg('config'),
      '@spiderwebs/core/bus': fileURLToPath(new URL('./packages/core/src/bus.ts', import.meta.url)),
      '@spiderwebs/core/exit': fileURLToPath(
        new URL('./packages/core/src/exit.ts', import.meta.url),
      ),
      '@spiderwebs/core': pkg('core'),
      '@spiderwebs/scanner': pkg('scanner'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
    },
  },
});
