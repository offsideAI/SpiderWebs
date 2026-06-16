import type { Component } from '@spiderwebs/schema';
import { describe, expect, it } from 'vitest';
import {
  OsvClient,
  OsvUnavailableError,
  osvFixedVersions,
  osvSeverity,
  osvVulnToFinding,
  type OsvVuln,
} from '../src/vulndb/osv.js';
import { SAMPLE_LODASH_VULN, makeFakeOsv } from './helpers/fakeOsv.js';

const lodash: Component = {
  name: 'lodash',
  version: '4.17.20',
  ecosystem: 'npm',
  purl: 'pkg:npm/lodash@4.17.20',
  direct: true,
  scope: 'runtime',
  pinned: true,
  manifestPath: 'package-lock.json',
  dependencyPaths: [['lodash@4.17.20']],
};

const vuln = SAMPLE_LODASH_VULN as unknown as OsvVuln;

describe('OSV mapping', () => {
  it('maps GHSA database_specific severity', () => {
    expect(osvSeverity(vuln)).toBe('high');
    expect(osvSeverity({ ...vuln, database_specific: {} } as OsvVuln)).toBe('unknown');
  });

  it('extracts first-fixed versions for the matching package only', () => {
    expect(osvFixedVersions(vuln, 'lodash')).toEqual(['4.17.21']);
    // A name that does not match any affected entry yields no fix versions.
    expect(osvFixedVersions(vuln, 'other')).toEqual([]);
  });

  it('builds a finding with a CVE-based title and stable id', () => {
    const finding = osvVulnToFinding(lodash, vuln);
    expect(finding.type).toBe('dependency');
    expect(finding.severity).toBe('high');
    expect(finding.title).toContain('CVE-2021-23337');
    expect(finding.fixedVersions).toEqual(['4.17.21']);
    expect(finding.advisory.cwes).toEqual(['CWE-94']);
    expect(finding.id).toMatch(/^sw-[0-9a-f]{16}$/);
    // Deterministic id derivation.
    expect(osvVulnToFinding(lodash, vuln).id).toBe(finding.id);
  });
});

describe('OsvClient', () => {
  const baseUrl = 'https://osv.test';

  it('queryBatch returns vuln ids aligned to the input components', async () => {
    const { fetchImpl } = makeFakeOsv({
      vulnIdsByName: { lodash: ['GHSA-35jh-r3h4-6jhm'], minimist: [] },
      vulnsById: {},
    });
    const client = new OsvClient({ fetchImpl, baseUrl });
    const result = await client.queryBatch([
      lodash,
      { ...lodash, name: 'minimist', purl: 'pkg:npm/minimist@1.2.5' },
    ]);
    expect(result).toEqual([['GHSA-35jh-r3h4-6jhm'], []]);
  });

  it('getVuln caches by id (one network call per id)', async () => {
    const { fetchImpl, calls } = makeFakeOsv({
      vulnIdsByName: {},
      vulnsById: { 'GHSA-35jh-r3h4-6jhm': SAMPLE_LODASH_VULN },
    });
    const client = new OsvClient({ fetchImpl, baseUrl });
    const a = await client.getVuln('GHSA-35jh-r3h4-6jhm');
    const b = await client.getVuln('GHSA-35jh-r3h4-6jhm');
    expect(a?.id).toBe('GHSA-35jh-r3h4-6jhm');
    expect(b).toBe(a);
    expect(calls.vulns).toHaveLength(1);
  });

  it('returns undefined for an unknown vuln id (404)', async () => {
    const { fetchImpl } = makeFakeOsv({ vulnIdsByName: {}, vulnsById: {} });
    const client = new OsvClient({ fetchImpl, baseUrl });
    expect(await client.getVuln('GHSA-missing')).toBeUndefined();
  });

  it('throws OsvUnavailableError when the network is down', async () => {
    const { fetchImpl } = makeFakeOsv({ vulnIdsByName: {}, vulnsById: {}, fail: true });
    const client = new OsvClient({ fetchImpl, baseUrl, retries: 0 });
    await expect(client.queryBatch([lodash])).rejects.toThrowError(OsvUnavailableError);
  });
});
