import { readFile } from 'node:fs/promises';
import type { Component } from '@spiderwebs/schema';
import type { ManifestFile, ManifestKind } from '../ingest.js';
import { dedupeComponents } from './common.js';
import { parseNpmLock } from './npm.js';
import { parsePnpmLock } from './pnpm.js';
import { parseYarnLock } from './yarn.js';

export * from './common.js';
export { parseNpmLock } from './npm.js';
export { parsePnpmLock, parsePnpmKey } from './pnpm.js';
export { parseYarnLock, yarnSelectorName } from './yarn.js';

const PARSERS: Record<ManifestKind, (content: string, manifestPath: string) => Component[]> = {
  'npm-lock': parseNpmLock,
  'pnpm-lock': parsePnpmLock,
  'yarn-lock': parseYarnLock,
};

export interface ParseManifestResult {
  manifest: ManifestFile;
  components: Component[];
  error?: string;
}

/** Parse a single discovered manifest from disk (never executes repo code). */
export async function parseManifest(manifest: ManifestFile): Promise<ParseManifestResult> {
  try {
    const content = await readFile(manifest.absPath, 'utf8');
    const components = PARSERS[manifest.kind](content, manifest.relPath);
    return { manifest, components };
  } catch (error) {
    return {
      manifest,
      components: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface DependencyGraph {
  components: Component[];
  manifestsParsed: number;
  errors: { manifestPath: string; message: string }[];
}

/** Parse all discovered manifests and merge into a de-duplicated graph. */
export async function buildDependencyGraph(
  manifests: readonly ManifestFile[],
): Promise<DependencyGraph> {
  const all: Component[] = [];
  const errors: DependencyGraph['errors'] = [];
  let parsed = 0;

  for (const manifest of manifests) {
    const result = await parseManifest(manifest);
    if (result.error) {
      errors.push({ manifestPath: manifest.relPath, message: result.error });
      continue;
    }
    parsed += 1;
    all.push(...result.components);
  }

  return { components: dedupeComponents(all), manifestsParsed: parsed, errors };
}
