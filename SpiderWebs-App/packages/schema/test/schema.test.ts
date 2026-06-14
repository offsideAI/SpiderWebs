import { describe, expect, it } from 'vitest';
import {
  AdvisorySchema,
  ComponentSchema,
  CorrelationSchema,
  FindingSchema,
  ReportSchema,
  RunEventSchema,
  dependencyFindingId,
  emptySeverityCounts,
  summarizeFindings,
  type Advisory,
  type Component,
  type Finding,
  type Report,
} from '../src/index.js';

const component: Component = ComponentSchema.parse({
  name: 'lodash',
  version: '4.17.20',
  ecosystem: 'npm',
  purl: 'pkg:npm/lodash@4.17.20',
  direct: false,
  manifestPath: 'package-lock.json',
  dependencyPaths: [['express@4.17.1', 'lodash@4.17.20']],
});

const advisory: Advisory = AdvisorySchema.parse({
  id: 'GHSA-35jh-r3h4-6jhm',
  aliases: ['CVE-2021-23337'],
  source: 'osv',
  summary: 'Command injection in lodash',
  severity: 'high',
  cvss: { version: '3.1', score: 7.2, vector: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H' },
  cwes: ['CWE-94'],
  kev: { listed: false },
  affectedRanges: ['<4.17.21'],
  fixedVersions: ['4.17.21'],
  references: [{ url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm' }],
});

const dependencyFinding: Finding = FindingSchema.parse({
  id: dependencyFindingId(component.purl, advisory.id),
  type: 'dependency',
  severity: 'high',
  title: 'lodash@4.17.20 — GHSA-35jh-r3h4-6jhm',
  component,
  advisory,
  fixedVersions: ['4.17.21'],
  dependencyPath: ['express@4.17.1', 'lodash@4.17.20'],
});

describe('ComponentSchema', () => {
  it('accepts a valid component and applies defaults', () => {
    expect(component.scope).toBe('unknown');
    expect(component.pinned).toBe(true);
  });

  it('rejects a purl that does not start with pkg:', () => {
    expect(ComponentSchema.safeParse({ ...component, purl: 'npm/lodash@4.17.20' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown ecosystem', () => {
    expect(ComponentSchema.safeParse({ ...component, ecosystem: 'homebrew' }).success).toBe(false);
  });
});

describe('AdvisorySchema', () => {
  it('rejects malformed CWE ids', () => {
    expect(AdvisorySchema.safeParse({ ...advisory, cwes: ['94'] }).success).toBe(false);
  });

  it('rejects out-of-range CVSS scores', () => {
    expect(
      AdvisorySchema.safeParse({
        ...advisory,
        cvss: { version: '3.1', score: 11, vector: 'CVSS:3.1/...' },
      }).success,
    ).toBe(false);
  });

  it('rejects out-of-range EPSS probabilities', () => {
    expect(
      AdvisorySchema.safeParse({ ...advisory, epss: { score: 1.5, percentile: 0.9 } }).success,
    ).toBe(false);
  });
});

describe('FindingSchema', () => {
  it('discriminates on type', () => {
    const secret = FindingSchema.parse({
      id: 'sw-0123456789abcdef',
      type: 'secret',
      severity: 'critical',
      title: 'AWS access key in config',
      rule: 'aws-access-key-id',
      location: { path: 'src/config.ts', startLine: 12 },
      redactedPreview: 'AKIA…[REDACTED]…X4QZ',
    });
    expect(secret.type).toBe('secret');
  });

  it('rejects ids that do not match the stable-id pattern', () => {
    expect(FindingSchema.safeParse({ ...dependencyFinding, id: 'finding-1' }).success).toBe(false);
  });

  it('rejects an unknown finding type', () => {
    expect(FindingSchema.safeParse({ ...dependencyFinding, type: 'exploit' }).success).toBe(false);
  });
});

describe('CorrelationSchema', () => {
  it('accepts both target kinds', () => {
    const base = {
      issueNumber: 42,
      issueTitle: 'Bump lodash',
      issueUrl: 'https://github.com/org/repo/issues/42',
      relationship: 'confirms-finding',
      confidence: 0.9,
      rationale: 'Issue cites CVE-2021-23337 matched by SCA.',
    };
    expect(
      CorrelationSchema.safeParse({
        ...base,
        target: { kind: 'finding', findingId: dependencyFinding.id },
      }).success,
    ).toBe(true);
    expect(
      CorrelationSchema.safeParse({
        ...base,
        relationship: 'describes-latent-risk',
        target: { kind: 'code', paths: ['src/auth.ts'] },
      }).success,
    ).toBe(true);
  });

  it('rejects confidence outside [0, 1]', () => {
    expect(
      CorrelationSchema.safeParse({
        issueNumber: 1,
        issueTitle: 't',
        issueUrl: 'https://example.com/1',
        target: { kind: 'code', paths: ['a.ts'] },
        relationship: 'describes-latent-risk',
        confidence: 1.2,
        rationale: 'r',
      }).success,
    ).toBe(false);
  });
});

describe('ReportSchema', () => {
  const report: Report = {
    schemaVersion: 1,
    tool: { name: 'spiderwebs', version: '0.1.0' },
    repo: { target: 'org/repo', ref: 'main' },
    scan: {
      startedAt: '2026-06-12T10:00:00.000Z',
      finishedAt: '2026-06-12T10:00:42.000Z',
      durationMs: 42_000,
    },
    dataSources: [{ name: 'osv', status: 'ok' }],
    summary: summarizeFindings([dependencyFinding]),
    components: [component],
    findings: [dependencyFinding],
    correlations: [],
    agent: { enabled: false },
  };

  it('round-trips a full report', () => {
    expect(ReportSchema.parse(report)).toEqual(report);
  });

  it('defaults agent to disabled', () => {
    const { agent: _agent, ...withoutAgent } = report;
    expect(ReportSchema.parse(withoutAgent).agent).toEqual({ enabled: false });
  });

  it('rejects a non-ISO scan timestamp', () => {
    expect(
      ReportSchema.safeParse({ ...report, scan: { ...report.scan, startedAt: 'yesterday' } })
        .success,
    ).toBe(false);
  });
});

describe('summarizeFindings', () => {
  it('returns all-zero counts for an empty run', () => {
    expect(summarizeFindings([])).toEqual({
      totalFindings: 0,
      bySeverity: emptySeverityCounts(),
      kevCount: 0,
      fixAvailableCount: 0,
    });
  });

  it('counts severity, KEV membership, and fix availability', () => {
    const kevFinding = FindingSchema.parse({
      ...dependencyFinding,
      id: 'sw-aaaaaaaaaaaaaaaa',
      severity: 'critical',
      advisory: { ...advisory, kev: { listed: true, dateAdded: '2026-01-15' } },
      fixedVersions: [],
    });
    const summary = summarizeFindings([dependencyFinding, kevFinding]);
    expect(summary.totalFindings).toBe(2);
    expect(summary.bySeverity.high).toBe(1);
    expect(summary.bySeverity.critical).toBe(1);
    expect(summary.kevCount).toBe(1);
    expect(summary.fixAvailableCount).toBe(1);
  });
});

describe('RunEventSchema', () => {
  const base = { runId: 'run-1', at: '2026-06-12T10:00:00.000Z' };

  it('accepts each lifecycle event', () => {
    for (const event of [
      { ...base, type: 'run:start', target: 'org/repo' },
      { ...base, type: 'stage:start', stage: 'deps' },
      { ...base, type: 'stage:progress', stage: 'deps', completed: 10, total: 100 },
      { ...base, type: 'finding:new', finding: dependencyFinding },
      { ...base, type: 'stage:done', stage: 'deps', durationMs: 1234 },
      { ...base, type: 'source:status', source: 'nvd', status: 'unavailable' },
      { ...base, type: 'log', level: 'info', message: 'hello' },
      { ...base, type: 'error', stage: 'enrich', message: 'boom', fatal: false },
      { ...base, type: 'run:done', exitCode: 0 },
    ]) {
      expect(RunEventSchema.safeParse(event).success, `event ${event.type}`).toBe(true);
    }
  });

  it('rejects unknown stages and event types', () => {
    expect(
      RunEventSchema.safeParse({ ...base, type: 'stage:start', stage: 'exploit' }).success,
    ).toBe(false);
    expect(RunEventSchema.safeParse({ ...base, type: 'finding:gone' }).success).toBe(false);
  });

  it('rejects exit codes outside 0–2', () => {
    expect(RunEventSchema.safeParse({ ...base, type: 'run:done', exitCode: 3 }).success).toBe(
      false,
    );
  });
});
