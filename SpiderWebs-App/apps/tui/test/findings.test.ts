import { describe, expect, it } from 'vitest';
import { filterFindings, searchText, sortFindings, visibleFindings } from '../src/findings.js';
import { MOCK_FINDINGS } from './fixtures/events.js';

describe('sortFindings', () => {
  it('orders by severity (most severe first)', () => {
    const sorted = sortFindings(MOCK_FINDINGS);
    expect(sorted[0]?.severity).toBe('critical');
    expect(sorted.at(-1)?.severity).toBe('low');
  });

  it('breaks severity ties by EPSS percentile', () => {
    const highs = sortFindings(MOCK_FINDINGS).filter((f) => f.severity === 'high');
    const percentiles = highs.map((f) =>
      f.type === 'dependency' ? f.advisory.epss?.percentile : 0,
    );
    const descending = [...percentiles].sort((a, b) => (b ?? 0) - (a ?? 0));
    expect(percentiles).toEqual(descending);
  });

  it('does not mutate the input', () => {
    const copy = [...MOCK_FINDINGS];
    sortFindings(MOCK_FINDINGS);
    expect(MOCK_FINDINGS).toEqual(copy);
  });
});

describe('filterFindings', () => {
  it('filters by severity', () => {
    const criticals = filterFindings(MOCK_FINDINGS, { severity: 'critical' });
    expect(criticals).toHaveLength(2);
    expect(criticals.every((f) => f.severity === 'critical')).toBe(true);
  });

  it('matches a query against package name, version, and advisory ids', () => {
    expect(filterFindings(MOCK_FINDINGS, { query: 'axios' })).toHaveLength(1);
    expect(filterFindings(MOCK_FINDINGS, { query: 'CVE-2021-44906' })).toHaveLength(1);
    expect(filterFindings(MOCK_FINDINGS, { query: '4.17.20' })).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    expect(filterFindings(MOCK_FINDINGS, { query: 'LODASH' })).toHaveLength(1);
  });

  it('returns everything for severity=all and empty query', () => {
    expect(filterFindings(MOCK_FINDINGS, { severity: 'all', query: '' })).toHaveLength(
      MOCK_FINDINGS.length,
    );
  });
});

describe('visibleFindings', () => {
  it('combines filter then sort', () => {
    const visible = visibleFindings(MOCK_FINDINGS, { severity: 'high' });
    expect(visible).toHaveLength(3);
    expect(visible.every((f) => f.severity === 'high')).toBe(true);
  });
});

describe('searchText', () => {
  it('includes the CVE alias', () => {
    const lodash = MOCK_FINDINGS.find((f) => f.component.name === 'lodash')!;
    expect(searchText(lodash)).toContain('cve-2021-23337');
  });
});
