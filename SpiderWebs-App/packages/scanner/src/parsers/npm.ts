import type { Component, DependencyScope } from '@spiderwebs/schema';
import { makeComponent } from './common.js';

interface LockPackageV3 {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  link?: boolean;
}

interface LockV3 {
  lockfileVersion?: number;
  packages?: Record<string, LockPackageV3>;
  dependencies?: Record<string, LockDepV1>;
}

interface LockDepV1 {
  version?: string;
  dev?: boolean;
  optional?: boolean;
  dependencies?: Record<string, LockDepV1>;
}

/** Extract the package name from a v2/v3 `packages` key (`node_modules/...`). */
function nameFromPath(path: string): string {
  const idx = path.lastIndexOf('node_modules/');
  return idx === -1 ? path : path.slice(idx + 'node_modules/'.length);
}

function depth(path: string): number {
  return path.split('node_modules/').length - 1;
}

function scopeOf(pkg: {
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
}): DependencyScope {
  if (pkg.optional) return 'optional';
  if (pkg.dev || pkg.devOptional) return 'development';
  return 'runtime';
}

/**
 * Parse `package-lock.json` / `npm-shrinkwrap.json` (lockfileVersion 1/2/3)
 * into normalized components. Lockfiles give exact, pinned versions (PRD §5.2).
 */
export function parseNpmLock(content: string, manifestPath: string): Component[] {
  const lock = JSON.parse(content) as LockV3;
  const components: Component[] = [];

  if (lock.packages) {
    for (const [path, pkg] of Object.entries(lock.packages)) {
      if (path === '' || pkg.link || !pkg.version) continue; // root / workspace links
      const name = nameFromPath(path);
      if (!name) continue;
      components.push(
        makeComponent({
          name,
          version: pkg.version,
          ecosystem: 'npm',
          direct: depth(path) === 1,
          scope: scopeOf(pkg),
          manifestPath,
        }),
      );
    }
    return components;
  }

  // lockfileVersion 1: nested `dependencies` tree.
  if (lock.dependencies) {
    const walk = (deps: Record<string, LockDepV1>, direct: boolean): void => {
      for (const [name, dep] of Object.entries(deps)) {
        if (dep.version) {
          components.push(
            makeComponent({
              name,
              version: dep.version,
              ecosystem: 'npm',
              direct,
              scope: dep.optional ? 'optional' : dep.dev ? 'development' : 'runtime',
              manifestPath,
            }),
          );
        }
        if (dep.dependencies) walk(dep.dependencies, false);
      }
    };
    walk(lock.dependencies, true);
  }

  return components;
}
