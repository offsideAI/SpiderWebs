import type { RunEvent } from '@spiderwebs/schema';
import { describe, expect, it, vi } from 'vitest';
import { EventBus, InvalidEventError } from '../src/index.js';

const at = '2026-06-12T10:00:00.000Z';
const stageStart: RunEvent = { type: 'stage:start', runId: 'r1', at, stage: 'deps' };
const stageDone: RunEvent = { type: 'stage:done', runId: 'r1', at, stage: 'deps', durationMs: 5 };

describe('EventBus', () => {
  it('delivers events to type-specific subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('stage:start', handler);
    bus.emit(stageStart);
    bus.emit(stageDone); // different type, not delivered
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(stageStart);
  });

  it('delivers every event to onAny subscribers', () => {
    const bus = new EventBus();
    const seen: RunEvent['type'][] = [];
    bus.onAny((event) => seen.push(event.type));
    bus.emit(stageStart);
    bus.emit(stageDone);
    expect(seen).toEqual(['stage:start', 'stage:done']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on('stage:start', handler);
    bus.emit(stageStart);
    unsubscribe();
    bus.emit(stageStart);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed events at the boundary', () => {
    const bus = new EventBus();
    expect(() =>
      bus.emit({ type: 'stage:start', runId: 'r1', at, stage: 'warp' } as unknown as RunEvent),
    ).toThrow(InvalidEventError);
  });

  it('a throwing subscriber does not block the others', () => {
    const bus = new EventBus();
    const second = vi.fn();
    bus.on('stage:start', () => {
      throw new Error('subscriber bug');
    });
    bus.on('stage:start', second);
    expect(() => bus.emit(stageStart)).toThrow(AggregateError);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
