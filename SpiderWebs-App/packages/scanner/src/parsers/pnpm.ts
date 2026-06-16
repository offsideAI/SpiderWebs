import type { Component, DependencyScope } from '@spiderwebs/schema';
import { parse as parseYaml } from 'yaml';
import { makeComponent } from './common.js';

interface PnpmLock {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  importers?: Record<
    string,
    { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  >;
  packages?: Record<string, { dev?: boolean; optional?: boolean }>;
}

/** Parse a `packages:` key into name + version across pnpm lockfile formats. */
export function parsePnpmKey(key: string): { name: string; version: string } | undefined {
  // Strip leading slash and any peer-dependency suffix: `(react@18.0.0)`.
  const body = key.replace(/^\//, '').replace(/\(.*\)$/, '');

  // v6+: `name@version` (scoped: `@scope/name@version`).
  const at = body.lastIndexOf('@');
  if (at > 0) {
    const name = body.slice(0, at);
    const version = body.slice(at + 1);
    if (/^\d/.test(version)) return { name, version };
  }

  // v5: `name/version` or `/@scope/name/version`.
  const slash = body.lastIndexOf('/');
  if (slash > 0) {
    const version = body.slice(slash + 1);
    if (/^\d/.test(version)) return { name: body.slice(0, slash), version };
  }
  return undefined;
}

function directNames(lock: PnpmLock): Map<string, DependencyScope> {
  const names = new Map<string, DependencyScope>();
  const add = (deps: Record<string, unknown> | undefined, scope: DependencyScope): void => {
    for (const name of Object.keys(deps ?? {})) names.set(name, scope);
  };
  add(lock.dependencies, 'runtime');
  add(lock.devDependencies, 'development');
  for (const importer of Object.values(lock.importers ?? {})) {
    add(importer.dependencies, 'runtime');
    add(importer.devDependencies, 'development');
  }
  return names;
}

/** Parse `pnpm-lock.yaml` (v5/v6/v9) into normalized components (PRD §5.2). */
export function parsePnpmLock(content: string, manifestPath: string): Component[] {
  const lock = (parseYaml(content) ?? {}) as PnpmLock;
  const direct = directNames(lock);
  const components: Component[] = [];

  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    const parsed = parsePnpmKey(key);
    if (!parsed) continue;
    const scope: DependencyScope = meta.optional
      ? 'optional'
      : (direct.get(parsed.name) ?? (meta.dev ? 'development' : 'runtime'));
    components.push(
      makeComponent({
        name: parsed.name,
        version: parsed.version,
        ecosystem: 'npm',
        direct: direct.has(parsed.name),
        scope,
        manifestPath,
      }),
    );
  }

  return components;
}
