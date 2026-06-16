import { fileURLToPath } from 'node:url';
import { EventBus } from '@spiderwebs/core/bus';
import type { RunEvent } from '@spiderwebs/schema';
import { describe, expect, it } from 'vitest';
import { runScan, type RunScanOptions } from '../src/orchestrator.js';
import { SAMPLE_LODASH_VULN, makeFakeOsv } from './helpers/fakeOsv.js';

const npmProject = fileURLToPath(new URL('./fixtures/npm-project/', import.meta.url));

function collect(bus: EventBus): RunEvent[] {
  const events: RunEvent[] = [];
  bus.onAny((e) => events.push(e));
  return events;
}

function withFakeOsv(extra: Partial<RunScanOptions> = {}): RunScanOptions {
  const { fetchImpl } = makeFakeOsv({
    vulnIdsByName: { lodash: ['GHSA-35jh-r3h4-6jhm'] },
    vulnsById: { 'GHSA-35jh-r3h4-6jhm': SAMPLE_LODASH_VULN },
  });
  return {
    target: npmProject,
    osv: { fetchImpl, baseUrl: 'https://osv.test', retries: 0 },
    ...extra,
  };
}

describe('runScan against a local repo', () => {
  it('produces findings from parsed deps + OSV and emits a full event stream', async () => {
    const bus = new EventBus();
    const events = collect(bus);
    const { report, exitCode } = await runScan(withFakeOsv({ failOn: 'high' }), bus);

    // Real findings from the fixture's lodash 4.17.20.
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0]!;
    expect(finding.type).toBe('dependency');
    expect(finding.severity).toBe('high');
    if (finding.type === 'dependency') {
      expect(finding.component.name).toBe('lodash');
      expect(finding.fixedVersions).toEqual(['4.17.21']);
    }

    // The whole graph is reported as components.
    expect(report.components.map((c) => c.name).sort()).toEqual([
      'glob',
      'lodash',
      'minimist',
      'rimraf',
    ]);

    // Event stream the TUI consumes.
    const types = events.map((e) => e.type);
    expect(types).toContain('run:start');
    expect(types).toContain('finding:new');
    expect(types.at(-1)).toBe('run:done');
    expect(
      events.some((e) => e.type === 'source:status' && e.source === 'osv' && e.status === 'ok'),
    ).toBe(true);

    // failOn high + a high finding -> exit 1.
    expect(exitCode).toBe(1);
    expect(report.dataSources.find((s) => s.name === 'osv')?.status).toBe('ok');
  });

  it('parses deps but skips OSV in offline mode', async () => {
    const bus = new EventBus();
    const events = collect(bus);
    const { report, exitCode } = await runScan({ target: npmProject, offline: true }, bus);

    expect(report.components).toHaveLength(4);
    expect(report.findings).toHaveLength(0);
    expect(exitCode).toBe(0);
    expect(report.dataSources.find((s) => s.name === 'osv')?.status).toBe('disabled');
    expect(events.some((e) => e.type === 'source:status' && e.status === 'disabled')).toBe(true);
  });

  it('marks OSV unavailable when the source is down (no whole-run failure)', async () => {
    const { fetchImpl } = makeFakeOsv({ vulnIdsByName: {}, vulnsById: {}, fail: true });
    const bus = new EventBus();
    const events = collect(bus);
    const { report, exitCode } = await runScan(
      { target: npmProject, osv: { fetchImpl, baseUrl: 'https://osv.test', retries: 0 } },
      bus,
    );

    expect(report.findings).toHaveLength(0);
    expect(report.components).toHaveLength(4); // deps still parsed
    expect(exitCode).toBe(0);
    expect(report.dataSources.find((s) => s.name === 'osv')?.status).toBe('unavailable');
    expect(events.some((e) => e.type === 'source:status' && e.status === 'unavailable')).toBe(true);
  });

  it('reports a fatal error for a missing local target (exit 2)', async () => {
    const bus = new EventBus();
    const events = collect(bus);
    const { exitCode } = await runScan({ target: '/no/such/repo/here' }, bus);

    expect(exitCode).toBe(2);
    expect(events.some((e) => e.type === 'error' && e.fatal)).toBe(true);
    const done = events.at(-1);
    expect(done?.type).toBe('run:done');
    if (done?.type === 'run:done') expect(done.exitCode).toBe(2);
  });
});
