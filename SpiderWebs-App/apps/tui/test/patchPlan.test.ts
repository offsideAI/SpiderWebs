import { dependencyFindingId, type DependencyFinding } from '@spiderwebs/schema';
import { describe, expect, it } from 'vitest';
import { MOCK_FINDINGS } from './fixtures/events.js';
import { compareVersions, derivePatchPlan } from '../src/patchPlan.js';

describe('compareVersions', () => {
  it('orders numerically by component', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
});

/** Build a minimal dependency finding for grouping/risk tests. */
function dep(
  name: string,
  version: string,
  fixed: string,
  severity: DependencyFinding['severity'],
): DependencyFinding {
  const purl = `pkg:npm/${name}@${version}`;
  const advisoryId = `GHSA-${name}-${version}`;
  return {
    id: dependencyFindingId(purl, advisoryId),
    type: 'dependency',
    severity,
    title: `${name}@${version}`,
    component: {
      name,
      version,
      ecosystem: 'npm',
      purl,
      direct: true,
      scope: 'runtime',
      pinned: true,
      manifestPath: 'package-lock.json',
      dependencyPaths: [[`${name}@${version}`]],
    },
    advisory: {
      id: advisoryId,
      aliases: [],
      source: 'osv',
      summary: 's',
      severity,
      cwes: [],
      affectedRanges: [`< ${fixed}`],
      fixedVersions: [fixed],
      references: [],
    },
    fixedVersions: [fixed],
    dependencyPath: [`${name}@${version}`],
  };
}

describe('derivePatchPlan', () => {
  it('produces one ordered step per fixable package', () => {
    const plan = derivePatchPlan(MOCK_FINDINGS);
    expect(plan).toHaveLength(8);
    expect(plan.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Highest-severity packages come first.
    expect(plan[0]?.topSeverity).toBe('critical');
  });

  it('groups multiple findings on the same package into one step', () => {
    const plan = derivePatchPlan([
      dep('lodash', '4.17.19', '4.17.21', 'high'),
      dep('lodash', '4.17.20', '4.17.21', 'critical'),
    ]);
    expect(plan).toHaveLength(1);
    const step = plan[0]!;
    expect(step.resolves).toBe(2);
    expect(step.fromVersions).toEqual(['4.17.19', '4.17.20']);
    expect(step.toVersion).toBe('4.17.21');
    expect(step.topSeverity).toBe('critical'); // worst severity in the group
  });

  it('flags a major version bump as higher risk', () => {
    const plan = derivePatchPlan([dep('axios', '0.21.1', '1.6.8', 'high')]);
    expect(plan[0]?.risk).toBe('major');
  });

  it('treats a patch-level fix as low risk', () => {
    const plan = derivePatchPlan([dep('semver', '5.7.1', '5.7.2', 'medium')]);
    expect(plan[0]?.risk).toBe('low');
  });

  it('skips findings with no fixed version', () => {
    const unfixable = dep('ghost', '1.0.0', '1.0.0', 'high');
    unfixable.fixedVersions = [];
    unfixable.advisory.fixedVersions = [];
    expect(derivePatchPlan([unfixable])).toHaveLength(0);
  });
});
