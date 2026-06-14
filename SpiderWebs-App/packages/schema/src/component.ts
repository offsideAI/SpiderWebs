import { z } from 'zod';

/** Ecosystem identifiers use OSV.dev naming so vulndb queries need no mapping (PRD §6). */
export const ECOSYSTEMS = [
  'npm',
  'PyPI',
  'Go',
  'crates.io',
  'Maven',
  'RubyGems',
  'Packagist',
] as const;

export const EcosystemSchema = z.enum(ECOSYSTEMS);
export type Ecosystem = z.infer<typeof EcosystemSchema>;

export const DependencyScopeSchema = z.enum(['runtime', 'development', 'optional', 'unknown']);
export type DependencyScope = z.infer<typeof DependencyScopeSchema>;

/** A resolved package in the dependency graph (PRD §5.2). */
export const ComponentSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  ecosystem: EcosystemSchema,
  /** Package URL, e.g. `pkg:npm/lodash@4.17.20`. */
  purl: z.string().startsWith('pkg:'),
  /** True when declared directly in a manifest in scope (vs transitive). */
  direct: z.boolean(),
  scope: DependencyScopeSchema.default('unknown'),
  /** False when resolved from manifest ranges instead of a lockfile ("unpinned/approximate"). */
  pinned: z.boolean().default(true),
  /** Repo-relative path of the manifest/lockfile this component came from. */
  manifestPath: z.string().min(1),
  /**
   * Dependency paths from a direct dependency to this component, each entry a
   * `name@version` chain. Direct deps have a single one-element path.
   */
  dependencyPaths: z.array(z.array(z.string().min(1)).min(1)).default([]),
});
export type Component = z.infer<typeof ComponentSchema>;
