import { EventBus } from '@spiderwebs/core';
import type { RunFixResult } from '@spiderwebs/scanner';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { App, type FixRequest } from '../src/components/App.js';
import { buildMockEvents } from './fixtures/events.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string | undefined): string => (s ?? '').replace(ANSI, '');

const DIFF = '+  "minimist": "^1.2.6"\n-  "minimist": "^1.2.5"';

/** Fake onFix that emits a step, asks for consent, then resolves per the answer. */
function makeOnFix(): (req: FixRequest) => Promise<RunFixResult> {
  return async (req) => {
    req.onEvent({ type: 'fix:step', step: 'patch', message: 'patching package.json' });
    const ok = await req.confirm({
      target: req.target,
      packageName: 'minimist',
      fromVersion: '1.2.5',
      toVersion: '1.2.6',
      branch: 'spiderwebs/fix-minimist-1.2.6',
      prTitle: 'fix(deps): bump minimist',
      diff: DIFF,
    });
    return ok
      ? {
          status: 'opened-pr',
          message: 'opened PR',
          prUrl: 'https://github.com/acme/widget-store/pull/9',
          branch: 'b',
        }
      : { status: 'committed', message: 'committed; consent not granted', branch: 'b' };
  };
}

/** Fake onFix that honors dry-run: previews without calling confirm. */
function makeDryRunAwareOnFix(): (req: FixRequest) => Promise<RunFixResult> {
  return async (req) => {
    req.onEvent({ type: 'fix:step', step: 'patch', message: 'patching package.json' });
    if (req.dryRun) {
      return { status: 'dry-run', message: 'would push and open a PR', diff: DIFF, branch: 'b' };
    }
    const ok = await req.confirm({
      target: req.target,
      packageName: 'minimist',
      fromVersion: '1.2.5',
      toVersion: '1.2.6',
      branch: 'spiderwebs/fix-minimist-1.2.6',
      prTitle: 'fix',
      diff: DIFF,
    });
    return ok
      ? { status: 'opened-pr', message: 'opened PR', prUrl: 'https://x/pull/9', branch: 'b' }
      : { status: 'committed', message: 'committed', branch: 'b' };
  };
}

async function mountWithFindings(
  onFix: (req: FixRequest) => Promise<RunFixResult>,
  options: { initialDryRun?: boolean } = {},
) {
  const bus = new EventBus();
  const harness = render(
    <App
      bus={bus}
      initialTarget="github.com/acme/widget-store"
      onFix={onFix}
      initialDryRun={options.initialDryRun ?? false}
      exitOnQuit={false}
    />,
  );
  await tick();
  for (const event of buildMockEvents()) bus.emit(event);
  await tick();
  return harness;
}

describe('TUI fix flow (F)', () => {
  it('pressing F shows progress then a consent prompt with the diff', async () => {
    const { lastFrame, stdin, unmount } = await mountWithFindings(makeOnFix());
    expect(strip(lastFrame())).toContain('Findings');

    stdin.write('F');
    await tick();
    await tick();

    const frame = strip(lastFrame());
    expect(frame).toContain('Guided fix');
    expect(frame).toContain('patching package.json'); // step streamed
    expect(frame).toContain('minimist'); // consent summary
    expect(frame).toContain('push'); // consent prompt
    expect(frame).toContain('"minimist": "^1.2.6"'); // diff shown
    unmount();
  });

  it('confirming with y opens the PR and shows the result', async () => {
    const onFix = vi.fn(makeOnFix());
    const { lastFrame, stdin, unmount } = await mountWithFindings(onFix);

    stdin.write('F');
    await tick();
    await tick();
    stdin.write('y'); // consent
    await tick();
    await tick();

    const frame = strip(lastFrame());
    expect(frame).toContain('opened-pr');
    expect(frame).toContain('pull/9');
    expect(onFix).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('declining with n keeps the local commit and does not open a PR', async () => {
    const { lastFrame, stdin, unmount } = await mountWithFindings(makeOnFix());

    stdin.write('F');
    await tick();
    await tick();
    stdin.write('n'); // decline
    await tick();
    await tick();

    const frame = strip(lastFrame());
    expect(frame).toContain('committed');
    expect(frame).not.toContain('pull/9');
    unmount();
  });

  it('dismissing the result returns to the findings view', async () => {
    const { lastFrame, stdin, unmount } = await mountWithFindings(makeOnFix());
    stdin.write('F');
    await tick();
    await tick();
    stdin.write('y');
    await tick();
    await tick();
    expect(strip(lastFrame())).toContain('opened-pr');

    stdin.write(' '); // any key dismisses
    await tick();
    const frame = strip(lastFrame());
    expect(frame).not.toContain('Guided fix');
    expect(frame).toContain('Findings');
    unmount();
  });
});

describe('TUI dry-run mode (D)', () => {
  it('D toggles dry-run and shows it in the header', async () => {
    const { lastFrame, stdin, unmount } = await mountWithFindings(makeDryRunAwareOnFix());
    expect(strip(lastFrame())).not.toContain('DRY-RUN');
    stdin.write('D');
    await tick();
    expect(strip(lastFrame())).toContain('DRY-RUN');
    stdin.write('D'); // toggle back off
    await tick();
    expect(strip(lastFrame())).not.toContain('DRY-RUN');
    unmount();
  });

  it('starting with --dry-run, F previews without a consent prompt', async () => {
    const onFix = vi.fn(makeDryRunAwareOnFix());
    const { lastFrame, stdin, unmount } = await mountWithFindings(onFix, { initialDryRun: true });
    expect(strip(lastFrame())).toContain('DRY-RUN');

    stdin.write('F');
    await tick();
    await tick();

    const frame = strip(lastFrame());
    expect(frame).toContain('dry-run'); // result status
    expect(frame).toContain('"minimist": "^1.2.6"'); // diff shown
    expect(frame).not.toContain('[y]'); // no consent prompt
    expect(frame).not.toContain('pull/'); // nothing pushed/opened
    // onFix was asked to dry-run.
    expect((onFix.mock.calls[0]![0] as FixRequest).dryRun).toBe(true);
    unmount();
  });

  it('toggling D on then F reaches a dry-run result', async () => {
    const { lastFrame, stdin, unmount } = await mountWithFindings(makeDryRunAwareOnFix());
    stdin.write('D');
    await tick();
    stdin.write('F');
    await tick();
    await tick();
    expect(strip(lastFrame())).toContain('dry-run');
    unmount();
  });
});

describe('TUI fix activity log', () => {
  it('streams granular log lines (workspace path, clone progress, the edit)', async () => {
    const onFix = async (req: FixRequest): Promise<RunFixResult> => {
      req.onEvent({ type: 'fix:step', step: 'workspace', message: 'preparing throwaway clone' });
      req.onEvent({ type: 'fix:log', message: 'workspace: ./.spiderwebs-workspace/acme-widgets' });
      req.onEvent({
        type: 'fix:log',
        message: 'cloning https://github.com/acme/widgets (shallow)…',
      });
      req.onEvent({ type: 'fix:log', message: 'clone receiving-objects 42%' });
      req.onEvent({
        type: 'fix:log',
        message: 'editing package.json: minimist "^1.2.5" → "^1.2.6"',
      });
      return { status: 'dry-run', message: 'would open PR', diff: DIFF, branch: 'b' };
    };
    const { lastFrame, stdin, unmount } = await mountWithFindings(onFix, { initialDryRun: true });
    stdin.write('F');
    await tick();
    await tick();

    const frame = strip(lastFrame());
    expect(frame).toContain('Activity log');
    expect(frame).toContain('.spiderwebs-workspace/acme-widgets');
    expect(frame).toContain('clone receiving-objects 42%');
    expect(frame).toContain('editing package.json');
    unmount();
  });
});
