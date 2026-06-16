import type { RunEvent } from '@spiderwebs/schema';
import { describe, expect, it } from 'vitest';
import { buildMockEvents } from './fixtures/events.js';
import { initialRunState, reduce, reduceAll } from '../src/state.js';

const at = '2026-06-15T10:00:00.000Z';
const base = { runId: 'r1', at };

describe('initialRunState', () => {
  it('starts with every stage pending and zeroed counts', () => {
    const state = initialRunState();
    expect(state.stages).toHaveLength(9);
    expect(state.stages.every((s) => s.status === 'pending')).toBe(true);
    expect(state.findings).toEqual([]);
    expect(state.counts.critical).toBe(0);
    expect(state.done).toBe(false);
  });
});

describe('reduce', () => {
  it('records run:start metadata', () => {
    const state = reduce(initialRunState(), { ...base, type: 'run:start', target: 'org/repo' });
    expect(state.target).toBe('org/repo');
    expect(state.startedAt).toBe(at);
  });

  it('moves a stage through active then done', () => {
    let state = reduce(initialRunState(), { ...base, type: 'stage:start', stage: 'deps' });
    expect(state.stages.find((s) => s.stage === 'deps')?.status).toBe('active');
    state = reduce(state, { ...base, type: 'stage:done', stage: 'deps', durationMs: 42 });
    const deps = state.stages.find((s) => s.stage === 'deps');
    expect(deps?.status).toBe('done');
    expect(deps?.durationMs).toBe(42);
  });

  it('does not mutate the previous state (pure reducer)', () => {
    const before = initialRunState();
    const after = reduce(before, { ...base, type: 'stage:start', stage: 'deps' });
    expect(before.stages.find((s) => s.stage === 'deps')?.status).toBe('pending');
    expect(after).not.toBe(before);
  });

  it('records source status', () => {
    const state = reduce(initialRunState(), {
      ...base,
      type: 'source:status',
      source: 'nvd',
      status: 'unavailable',
    });
    expect(state.sources.nvd).toBe('unavailable');
  });

  it('marks the run done with its exit code', () => {
    const state = reduce(initialRunState(), { ...base, type: 'run:done', exitCode: 1 });
    expect(state.done).toBe(true);
    expect(state.exitCode).toBe(1);
  });

  it('caps the log buffer', () => {
    let state = initialRunState();
    for (let i = 0; i < 250; i++) {
      const event: RunEvent = { ...base, type: 'log', level: 'info', message: `line ${i}` };
      state = reduce(state, event);
    }
    expect(state.logs.length).toBeLessThanOrEqual(200);
    expect(state.logs.at(-1)?.message).toBe('line 249');
  });
});

describe('reduceAll over the mock stream', () => {
  it('produces the expected terminal state', () => {
    const state = reduceAll(buildMockEvents());
    expect(state.done).toBe(true);
    expect(state.exitCode).toBe(1);
    expect(state.findings).toHaveLength(8);
    expect(state.counts).toMatchObject({ critical: 2, high: 3, medium: 2, low: 1 });
    expect(state.kevCount).toBe(1);
    expect(state.stages.find((s) => s.stage === 'enrich')?.status).toBe('done');
  });
});
