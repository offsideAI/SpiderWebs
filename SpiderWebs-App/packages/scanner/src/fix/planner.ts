import type { DependencyFinding, Ecosystem } from '@spiderwebs/schema';
import semver from 'semver';

/** npm package managers we can regenerate a lockfile for (v1 scope: npm ecosystem). */
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export type ManifestField =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';

const MANIFEST_FIELDS: ManifestField[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

/** A concrete, applyable upgrade for one direct dependency (§5.11). */
export interface FixPlan {
  packageName: string;
  ecosystem: Ecosystem;
  fromVersion: string;
  toVersion: string;
  /** package.json that declares the dep (repo-relative, forward slashes). */
  manifestPath: string;
  /** Lockfile to regenerate after the manifest edit. */
  lockfilePath: string;
  manager: PackageManager;
  field: ManifestField;
  currentRange: string;
  newRange: string;
  /** True when we could not preserve the original range operator and defaulted to `^`. */
  rangeRewritten: boolean;
  resolvesFindingIds: string[];
  resolvesAdvisoryIds: string[];
}

export type FixSkipReason =
  | 'transitive'
  | 'no-fix-available'
  | 'unsupported-ecosystem'
  | 'not-in-manifest'
  | 'already-satisfied';

export type FixPlanResult =
  | { status: 'planned'; plan: FixPlan }
  | { status: 'skipped'; reason: FixSkipReason; detail: string; packageName: string };

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/** Map a lockfile path to the sibling package.json that declares direct deps. */
export function manifestPathForLockfile(lockfilePath: string): string {
  return lockfilePath.includes('/')
    ? lockfilePath.replace(/[^/]+$/, 'package.json')
    : 'package.json';
}

/** Determine which package manager owns a given lockfile. */
export function managerForLockfile(lockfilePath: string): PackageManager | undefined {
  const base = lockfilePath.split('/').pop() ?? lockfilePath;
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'npm';
  if (base === 'pnpm-lock.yaml') return 'pnpm';
  if (base === 'yarn.lock') return 'yarn';
  return undefined;
}

/** Lowest fixed version strictly greater than the installed one. */
export function selectTargetVersion(
  fixedVersions: readonly string[],
  current: string,
): string | undefined {
  const currentValid = semver.valid(current) ?? semver.coerce(current)?.version;
  if (!currentValid) return undefined;
  const candidates = fixedVersions
    .filter((v) => semver.valid(v))
    .filter((v) => semver.gt(v, currentValid))
    .sort(semver.compare);
  return candidates[0];
}

/** Replace the version in a range while preserving a simple leading operator. */
export function rewriteRange(
  currentRange: string,
  toVersion: string,
): { newRange: string; rewritten: boolean } {
  const match = currentRange.trim().match(/^(\^|~|>=|>|<=|<)?\s*v?\d[\w.+-]*$/);
  if (match) {
    const op = match[1] ?? '';
    return { newRange: `${op}${toVersion}`, rewritten: false };
  }
  // Complex/unknown ranges (e.g. "*", "x || y", git/url specs): fall back to caret.
  return { newRange: `^${toVersion}`, rewritten: true };
}

function findDeclaration(
  pkg: PackageJsonLike,
  name: string,
): { field: ManifestField; range: string } | undefined {
  for (const field of MANIFEST_FIELDS) {
    const range = pkg[field]?.[name];
    if (typeof range === 'string') return { field, range };
  }
  return undefined;
}

/**
 * Plan a fix for a single dependency finding (§5.11). Pure: given the finding and
 * the parsed declaring package.json, it returns either a concrete `FixPlan` or a
 * reason it was skipped. v1 scope is **direct** dependencies in the npm ecosystem.
 */
export function planFix(finding: DependencyFinding, packageJson: PackageJsonLike): FixPlanResult {
  const { component, advisory } = finding;
  const skip = (reason: FixSkipReason, detail: string): FixPlanResult => ({
    status: 'skipped',
    reason,
    detail,
    packageName: component.name,
  });

  if (component.ecosystem !== 'npm') {
    return skip('unsupported-ecosystem', `${component.ecosystem} fixes are not supported yet`);
  }
  if (!component.direct) {
    return skip('transitive', 'only direct dependencies can be fixed in this version');
  }

  const target = selectTargetVersion(finding.fixedVersions, component.version);
  if (!target) {
    return skip(
      'no-fix-available',
      finding.fixedVersions.length === 0
        ? 'no upstream fixed version is available'
        : `installed ${component.version} already satisfies the fix`,
    );
  }

  const manager = managerForLockfile(component.manifestPath);
  if (!manager) {
    return skip('unsupported-ecosystem', `unrecognized lockfile: ${component.manifestPath}`);
  }

  const declaration = findDeclaration(packageJson, component.name);
  if (!declaration) {
    return skip(
      'not-in-manifest',
      `${component.name} is not declared in ${manifestPathForLockfile(component.manifestPath)} ` +
        '(likely a workspace member or hoisted dep)',
    );
  }

  const { newRange, rewritten } = rewriteRange(declaration.range, target);
  return {
    status: 'planned',
    plan: {
      packageName: component.name,
      ecosystem: component.ecosystem,
      fromVersion: component.version,
      toVersion: target,
      manifestPath: manifestPathForLockfile(component.manifestPath),
      lockfilePath: component.manifestPath,
      manager,
      field: declaration.field,
      currentRange: declaration.range,
      newRange,
      rangeRewritten: rewritten,
      resolvesFindingIds: [finding.id],
      resolvesAdvisoryIds: [advisory.id],
    },
  };
}

/**
 * Combine several plans for the **same package** into one upgrade (one PR per
 * package, PRD §5.11): take the highest target version and union the resolved ids.
 */
export function combineFixPlans(plans: readonly FixPlan[]): FixPlan {
  if (plans.length === 0) throw new Error('combineFixPlans: no plans');
  const sorted = [...plans].sort((a, b) => semver.compare(a.toVersion, b.toVersion));
  const top = sorted.at(-1)!;
  const dedup = (xs: string[]): string[] => [...new Set(xs)].sort();
  return {
    ...top,
    fromVersion: sorted[0]!.fromVersion,
    resolvesFindingIds: dedup(plans.flatMap((p) => p.resolvesFindingIds)),
    resolvesAdvisoryIds: dedup(plans.flatMap((p) => p.resolvesAdvisoryIds)),
  };
}
