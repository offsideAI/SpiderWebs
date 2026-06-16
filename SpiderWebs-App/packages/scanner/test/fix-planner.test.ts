import {
  dependencyFindingId,
  type DependencyFinding,
  type Ecosystem,
  type Severity,
} from '@spiderwebs/schema';
import { describe, expect, it } from 'vitest';
import {
  combineFixPlans,
  managerForLockfile,
  manifestPathForLockfile,
  planFix,
  rewriteRange,
  selectTargetVersion,
  type FixPlan,
  type PackageJsonLike,
} from '../src/fix/planner.js';

interface FindingOverrides {
  name?: string;
  version?: string;
  ecosystem?: Ecosystem;
  direct?: boolean;
  severity?: Severity;
  fixedVersions?: string[];
  manifestPath?: string;
  advisoryId?: string;
}

function makeFinding(o: FindingOverrides = {}): DependencyFinding {
  const name = o.name ?? 'lodash';
  const version = o.version ?? '4.17.20';
  const ecosystem = o.ecosystem ?? 'npm';
  const purl = `pkg:npm/${name}@${version}`;
  const advisoryId = o.advisoryId ?? 'GHSA-aaaa-bbbb-cccc';
  return {
    id: dependencyFindingId(purl, advisoryId),
    type: 'dependency',
    severity: o.severity ?? 'high',
    title: `${name}@${version}`,
    component: {
      name,
      version,
      ecosystem,
      purl,
      direct: o.direct ?? true,
      scope: 'runtime',
      pinned: true,
      manifestPath: o.manifestPath ?? 'package-lock.json',
      dependencyPaths: [[`${name}@${version}`]],
    },
    advisory: {
      id: advisoryId,
      aliases: ['CVE-2099-0001'],
      source: 'osv',
      summary: 's',
      severity: o.severity ?? 'high',
      cwes: [],
      affectedRanges: [],
      fixedVersions: o.fixedVersions ?? ['4.17.21'],
      references: [],
    },
    fixedVersions: o.fixedVersions ?? ['4.17.21'],
    dependencyPath: [`${name}@${version}`],
  };
}

const pkg = (deps: Record<string, string>, field = 'dependencies'): PackageJsonLike => ({
  name: 'demo',
  [field]: deps,
});

describe('manifestPathForLockfile', () => {
  it('maps a lockfile to the sibling package.json', () => {
    expect(manifestPathForLockfile('package-lock.json')).toBe('package.json');
    expect(manifestPathForLockfile('packages/api/pnpm-lock.yaml')).toBe(
      'packages/api/package.json',
    );
  });
});

describe('managerForLockfile', () => {
  it('recognizes each npm-family lockfile', () => {
    expect(managerForLockfile('package-lock.json')).toBe('npm');
    expect(managerForLockfile('a/pnpm-lock.yaml')).toBe('pnpm');
    expect(managerForLockfile('yarn.lock')).toBe('yarn');
    expect(managerForLockfile('Cargo.lock')).toBeUndefined();
  });
});

describe('selectTargetVersion', () => {
  it('picks the lowest fixed version greater than current', () => {
    expect(selectTargetVersion(['4.17.21', '4.18.0'], '4.17.20')).toBe('4.17.21');
  });
  it('ignores fixed versions not greater than current', () => {
    expect(selectTargetVersion(['4.17.19', '4.17.20'], '4.17.20')).toBeUndefined();
  });
  it('returns undefined when there are no valid fixes', () => {
    expect(selectTargetVersion([], '1.0.0')).toBeUndefined();
  });
});

describe('rewriteRange', () => {
  it.each([
    ['^4.17.20', '4.17.21', '^4.17.21'],
    ['~1.2.3', '1.2.9', '~1.2.9'],
    ['>=2.0.0', '2.1.0', '>=2.1.0'],
    ['1.2.3', '1.2.4', '1.2.4'],
  ])('preserves the operator: %s -> %s', (range, to, expected) => {
    expect(rewriteRange(range, to)).toEqual({ newRange: expected, rewritten: false });
  });

  it('falls back to caret for complex ranges', () => {
    expect(rewriteRange('*', '4.17.21')).toEqual({ newRange: '^4.17.21', rewritten: true });
    expect(rewriteRange('1.x || 2.x', '3.0.0')).toEqual({ newRange: '^3.0.0', rewritten: true });
  });
});

describe('planFix', () => {
  it('plans a direct npm dependency upgrade and preserves the range operator', () => {
    const result = planFix(makeFinding(), pkg({ lodash: '^4.17.20' }));
    expect(result.status).toBe('planned');
    if (result.status !== 'planned') return;
    expect(result.plan).toMatchObject({
      packageName: 'lodash',
      fromVersion: '4.17.20',
      toVersion: '4.17.21',
      manifestPath: 'package.json',
      lockfilePath: 'package-lock.json',
      manager: 'npm',
      field: 'dependencies',
      currentRange: '^4.17.20',
      newRange: '^4.17.21',
      rangeRewritten: false,
    });
    expect(result.plan.resolvesAdvisoryIds).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });

  it('finds the dep in devDependencies', () => {
    const result = planFix(makeFinding(), pkg({ lodash: '^4.17.20' }, 'devDependencies'));
    expect(result.status === 'planned' && result.plan.field).toBe('devDependencies');
  });

  it('skips transitive dependencies', () => {
    const result = planFix(makeFinding({ direct: false }), pkg({ lodash: '^4.17.20' }));
    expect(result).toMatchObject({ status: 'skipped', reason: 'transitive' });
  });

  it('skips when no upstream fix exists', () => {
    const result = planFix(makeFinding({ fixedVersions: [] }), pkg({ lodash: '^4.17.20' }));
    expect(result).toMatchObject({ status: 'skipped', reason: 'no-fix-available' });
  });

  it('skips unsupported ecosystems', () => {
    const result = planFix(
      makeFinding({ ecosystem: 'PyPI', manifestPath: 'requirements.txt' }),
      pkg({ lodash: '1' }),
    );
    expect(result).toMatchObject({ status: 'skipped', reason: 'unsupported-ecosystem' });
  });

  it('skips when the dep is not declared in the manifest', () => {
    const result = planFix(makeFinding(), pkg({ express: '^4.0.0' }));
    expect(result).toMatchObject({ status: 'skipped', reason: 'not-in-manifest' });
  });
});

describe('combineFixPlans', () => {
  it('takes the highest target and unions resolved ids (one PR per package)', () => {
    const base: FixPlan = {
      packageName: 'lodash',
      ecosystem: 'npm',
      fromVersion: '4.17.20',
      toVersion: '4.17.21',
      manifestPath: 'package.json',
      lockfilePath: 'package-lock.json',
      manager: 'npm',
      field: 'dependencies',
      currentRange: '^4.17.20',
      newRange: '^4.17.21',
      rangeRewritten: false,
      resolvesFindingIds: ['sw-1111111111111111'],
      resolvesAdvisoryIds: ['GHSA-1'],
    };
    const combined = combineFixPlans([
      base,
      {
        ...base,
        toVersion: '4.18.0',
        newRange: '^4.18.0',
        resolvesFindingIds: ['sw-2222222222222222'],
        resolvesAdvisoryIds: ['GHSA-2'],
      },
    ]);
    expect(combined.toVersion).toBe('4.18.0');
    expect(combined.resolvesAdvisoryIds).toEqual(['GHSA-1', 'GHSA-2']);
    expect(combined.resolvesFindingIds).toHaveLength(2);
  });
});
