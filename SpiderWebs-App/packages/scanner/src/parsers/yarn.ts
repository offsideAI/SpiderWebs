import type { Component } from '@spiderwebs/schema';
import { parse as parseYaml } from 'yaml';
import { makeComponent } from './common.js';

/** Pull the package name out of a yarn selector like `@scope/name@^1.2.0`. */
export function yarnSelectorName(selector: string): string {
  let s = selector.trim().replace(/^"|"$/g, '');
  // Drop a protocol prefix on the range, e.g. `lodash@npm:^4` -> name is `lodash`.
  const scoped = s.startsWith('@');
  const at = s.indexOf('@', scoped ? 1 : 0);
  if (at > 0) s = s.slice(0, at);
  return s;
}

/**
 * Parse a classic (v1) `yarn.lock`. The format is blocks of one-or-more
 * comma-separated selectors ending in `:`, followed by an indented
 * `version "x"` line.
 */
function parseYarnV1(content: string, manifestPath: string): Component[] {
  const components: Component[] = [];
  const lines = content.split(/\r?\n/);
  let pendingName: string | undefined;

  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) {
      pendingName = undefined;
      continue;
    }
    const isHeader = !/^\s/.test(line) && line.trimEnd().endsWith(':');
    if (isHeader) {
      const header = line.trimEnd().replace(/:$/, '');
      const firstSelector = header.split(',')[0] ?? '';
      pendingName = yarnSelectorName(firstSelector);
      continue;
    }
    const versionMatch = line.match(/^\s+version:?\s+"?([^"\s]+)"?/);
    if (versionMatch && pendingName) {
      components.push(
        makeComponent({
          name: pendingName,
          version: versionMatch[1]!,
          ecosystem: 'npm',
          // yarn.lock does not distinguish direct vs transitive on its own.
          direct: false,
          manifestPath,
        }),
      );
      pendingName = undefined;
    }
  }

  return components;
}

/** Parse a Berry (yarn 2+) `yarn.lock`, which is YAML keyed by selector. */
function parseYarnBerry(content: string, manifestPath: string): Component[] {
  const doc = (parseYaml(content) ?? {}) as Record<string, { version?: string }>;
  const components: Component[] = [];
  for (const [selector, meta] of Object.entries(doc)) {
    if (selector === '__metadata' || !meta?.version) continue;
    const name = yarnSelectorName(selector.split(',')[0] ?? '');
    if (!name) continue;
    components.push(
      makeComponent({
        name,
        version: meta.version,
        ecosystem: 'npm',
        direct: false,
        manifestPath,
      }),
    );
  }
  return components;
}

export function parseYarnLock(content: string, manifestPath: string): Component[] {
  return content.includes('__metadata:')
    ? parseYarnBerry(content, manifestPath)
    : parseYarnV1(content, manifestPath);
}
