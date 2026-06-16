import { EventBus } from '@spiderwebs/core';
import type { RunEvent } from '@spiderwebs/schema';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../src/components/App.js';
import { buildMockEvents } from './fixtures/events.js';

const ESC = String.fromCharCode(27);
const KEY = {
  down: `${ESC}[B`,
  up: `${ESC}[A`,
  tab: '\t',
  escape: ESC,
} as const;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string | undefined): string => (s ?? '').replace(ANSI, '');

function emit(bus: EventBus, events: readonly RunEvent[]): void {
  for (const event of events) bus.emit(event);
}

async function mountWithRun(options: { includeDone?: boolean } = {}) {
  const bus = new EventBus();
  const harness = render(
    <App bus={bus} initialTarget="github.com/acme/widget-store" exitOnQuit={false} />,
  );
  await tick(); // let the subscription effect attach
  const events = buildMockEvents().filter(
    (e) => options.includeDone !== false || e.type !== 'run:done',
  );
  emit(bus, events);
  await tick();
  return harness;
}

describe('progress view', () => {
  it('streams severity counts and stages while scanning', async () => {
    const { lastFrame, unmount } = await mountWithRun({ includeDone: false });
    const frame = strip(lastFrame());
    expect(frame).toContain('Scan progress');
    expect(frame).toContain('critical');
    expect(frame).toContain('Enrich');
    expect(frame).toContain('KEV');
    unmount();
  });
});

describe('findings view', () => {
  it('auto-switches to findings when the run completes and shows the top finding', async () => {
    const { lastFrame, unmount } = await mountWithRun();
    const frame = strip(lastFrame());
    expect(frame).toContain('Findings');
    // Top of the sorted list is the highest-EPSS critical (minimist).
    expect(frame).toContain('minimist');
    expect(frame).toContain('CVE-2021-44906');
    unmount();
  });

  it('moves the selection with the arrow keys', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun();
    stdin.write(KEY.down);
    await tick();
    // Second critical by EPSS is shell-quote — detail pane should follow.
    expect(strip(lastFrame())).toContain('shell-quote');
    unmount();
  });

  it('cycles the severity filter with f', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun();
    stdin.write('f'); // all -> critical
    await tick();
    const frame = strip(lastFrame());
    expect(frame).toContain('filter:');
    expect(frame).toContain('critical');
    expect(frame).toContain('minimist'); // critical kept
    expect(frame).not.toContain('json5'); // low filtered out
    unmount();
  });

  it('filters by fuzzy search', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun();
    stdin.write('/');
    await tick();
    stdin.write('axios');
    await tick();
    const frame = strip(lastFrame());
    expect(frame).toContain('axios');
    expect(frame).not.toContain('minimist');
    // Escape clears the search.
    stdin.write(KEY.escape);
    await tick();
    expect(strip(lastFrame())).toContain('minimist');
    unmount();
  });
});

describe('patch plan view', () => {
  it('shows ordered upgrade steps', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun();
    stdin.write('3'); // jump to patch plan
    await tick();
    const frame = strip(lastFrame());
    expect(frame).toContain('Patch plan');
    expect(frame).toContain('minimist');
    expect(frame).toContain('resolve');
    unmount();
  });
});

describe('global navigation', () => {
  it('cycles views with tab', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun({ includeDone: false });
    expect(strip(lastFrame())).toContain('Scan progress');
    stdin.write(KEY.tab);
    await tick();
    expect(strip(lastFrame())).toContain('Findings');
    stdin.write(KEY.tab);
    await tick();
    expect(strip(lastFrame())).toContain('Patch plan');
    unmount();
  });

  it('toggles the help overlay with ?', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun();
    stdin.write('?');
    await tick();
    expect(strip(lastFrame())).toContain('Keyboard shortcuts');
    unmount();
  });

  it('does not crash when quitting with exitOnQuit disabled', async () => {
    const { lastFrame, stdin, unmount } = await mountWithRun();
    stdin.write('q');
    await tick();
    expect(lastFrame()).toBeDefined();
    unmount();
  });
});
