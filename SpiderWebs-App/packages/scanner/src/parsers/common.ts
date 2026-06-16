import type { Component, DependencyScope, Ecosystem } from '@spiderwebs/schema';

export interface ComponentInput {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  direct: boolean;
  scope?: DependencyScope;
  pinned?: boolean;
  manifestPath: string;
}

/** Build a normalized Component with a purl and a default dependency path. */
export function makeComponent(input: ComponentInput): Component {
  const purl = `pkg:${ecosystemPurlType(input.ecosystem)}/${input.name}@${input.version}`;
  return {
    name: input.name,
    version: input.version,
    ecosystem: input.ecosystem,
    purl,
    direct: input.direct,
    scope: input.scope ?? 'unknown',
    pinned: input.pinned ?? true,
    manifestPath: input.manifestPath,
    // Full transitive path reconstruction is best-effort in this slice; we record
    // the component itself so the UI always has a non-empty path to show.
    dependencyPaths: [[`${input.name}@${input.version}`]],
  };
}

function ecosystemPurlType(ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case 'npm':
      return 'npm';
    case 'PyPI':
      return 'pypi';
    case 'Go':
      return 'golang';
    case 'crates.io':
      return 'cargo';
    case 'Maven':
      return 'maven';
    case 'RubyGems':
      return 'gem';
    case 'Packagist':
      return 'composer';
  }
}

/**
 * De-duplicate components by name@version, keeping the "most direct" record so a
 * package that is both a direct and transitive dependency is reported as direct.
 */
export function dedupeComponents(components: readonly Component[]): Component[] {
  const byKey = new Map<string, Component>();
  for (const component of components) {
    const key = `${component.ecosystem} ${component.name}@${component.version}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, component);
    } else if (component.direct && !existing.direct) {
      byKey.set(key, { ...existing, direct: true, scope: component.scope });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}
