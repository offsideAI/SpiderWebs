/** A minimal in-memory OSV.dev stand-in for tests — no real network. */
export interface FakeOsvConfig {
  /** Vulnerability ids returned by querybatch, keyed by package name. */
  vulnIdsByName: Record<string, string[]>;
  /** Full vulnerability records returned by /v1/vulns/{id}. */
  vulnsById: Record<string, unknown>;
  /** Force every request to fail (to exercise the unavailable path). */
  fail?: boolean;
}

export const SAMPLE_LODASH_VULN = {
  id: 'GHSA-35jh-r3h4-6jhm',
  summary: 'Command injection in lodash',
  aliases: ['CVE-2021-23337'],
  modified: '2023-01-01T00:00:00Z',
  published: '2021-02-15T00:00:00Z',
  references: [{ type: 'ADVISORY', url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm' }],
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
  affected: [
    {
      package: { ecosystem: 'npm', name: 'lodash' },
      ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
    },
  ],
  database_specific: { severity: 'HIGH', cwe_ids: ['CWE-94'] },
};

interface BatchBody {
  queries: { package: { name: string; ecosystem: string }; version: string }[];
}

/** Build a `fetch`-compatible function backed by the fake OSV data. */
export function makeFakeOsv(config: FakeOsvConfig): {
  fetchImpl: typeof fetch;
  calls: { batch: number; vulns: string[] };
} {
  const calls = { batch: 0, vulns: [] as string[] };

  const fetchImpl: typeof fetch = async (input, init) => {
    if (config.fail) throw new Error('network down');
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);

    if (url.endsWith('/v1/querybatch')) {
      calls.batch += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as BatchBody;
      const results = body.queries.map((q) => ({
        vulns: (config.vulnIdsByName[q.package.name] ?? []).map((id) => ({ id })),
      }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }

    const vulnMatch = url.match(/\/v1\/vulns\/(.+)$/);
    if (vulnMatch) {
      const id = decodeURIComponent(vulnMatch[1]!);
      calls.vulns.push(id);
      const record = config.vulnsById[id];
      return record
        ? new Response(JSON.stringify(record), { status: 200 })
        : new Response('not found', { status: 404 });
    }

    return new Response('unexpected', { status: 500 });
  };

  return { fetchImpl, calls };
}
