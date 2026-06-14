import type { Severity } from '@spiderwebs/schema';
import { describe, expect, it } from 'vitest';
import { ExitCode, determineExitCode, severityMeetsThreshold } from '../src/index.js';

const f = (severity: Severity) => ({ severity });

describe('severityMeetsThreshold', () => {
  it('never trips with failOn=none', () => {
    for (const severity of ['critical', 'high', 'medium', 'low', 'info', 'unknown'] as const) {
      expect(severityMeetsThreshold(severity, 'none')).toBe(false);
    }
  });

  it('compares against the severity ladder', () => {
    expect(severityMeetsThreshold('critical', 'high')).toBe(true);
    expect(severityMeetsThreshold('high', 'high')).toBe(true);
    expect(severityMeetsThreshold('medium', 'high')).toBe(false);
    expect(severityMeetsThreshold('low', 'low')).toBe(true);
    expect(severityMeetsThreshold('info', 'low')).toBe(false);
  });

  it('treats unknown severity as low so it cannot slip past a low gate', () => {
    expect(severityMeetsThreshold('unknown', 'low')).toBe(true);
    expect(severityMeetsThreshold('unknown', 'medium')).toBe(false);
  });
});

describe('determineExitCode (PRD §5.10)', () => {
  it('returns 0 for a clean run', () => {
    expect(determineExitCode([], 'low')).toBe(ExitCode.Clean);
  });

  it('returns 0 when findings are all below threshold', () => {
    expect(determineExitCode([f('medium'), f('low')], 'high')).toBe(ExitCode.Clean);
  });

  it('returns 1 when any finding meets the threshold', () => {
    expect(determineExitCode([f('low'), f('high')], 'high')).toBe(ExitCode.FindingsAtThreshold);
    expect(determineExitCode([f('critical')], 'critical')).toBe(ExitCode.FindingsAtThreshold);
  });

  it('returns 0 regardless of findings when failOn=none', () => {
    expect(determineExitCode([f('critical')], 'none')).toBe(ExitCode.Clean);
  });
});
