import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCKFILE_REGEN_ARGS,
  applyFix,
  detectJsonIndent,
  setDependencyRange,
  type PackageManagerRunner,
  type PmRegenInput,
} from '../src/fix/patcher.js';
import type { FixPlan } from '../src/fix/planner.js';

function makePlan(over: Partial<FixPlan> = {}): FixPlan {
  return {
    packageName: 'lodash',
    ecosystem: 'npm',
    fromVersion: '4.17.20',
    toVersion: '4.17.21',
    manifestPath: 'package.json',
    lockfilePath: 'package-lock.json',
    manager: 'npm',
    field: 'dependencies',
    currentRange: '^4.17.20',
    newRange: '^4.17.21',
    rangeRewritten: false,
    resolvesFindingIds: ['sw-0000000000000000'],
    resolvesAdvisoryIds: ['GHSA-x'],
    ...over,
  };
}

function recordingRunner(): { runner: PackageManagerRunner; calls: PmRegenInput[] } {
  const calls: PmRegenInput[] = [];
  const runner: PackageManagerRunner = {
    regenerateLockfile: vi.fn(async (input: PmRegenInput) => {
      calls.push(input);
      return { ok: true, command: `${input.manager} install`, stdout: '', stderr: '' };
    }),
  };
  return { runner, calls };
}

describe('LOCKFILE_REGEN_ARGS (safety invariant)', () => {
  it('always disables lifecycle scripts', () => {
    for (const manager of ['npm', 'pnpm', 'yarn'] as const) {
      expect(LOCKFILE_REGEN_ARGS[manager]).toContain('--ignore-scripts');
    }
  });

  it('uses lockfile-only modes (no node_modules build) for npm/pnpm', () => {
    expect(LOCKFILE_REGEN_ARGS.npm).toContain('--package-lock-only');
    expect(LOCKFILE_REGEN_ARGS.pnpm).toContain('--lockfile-only');
  });
});

describe('detectJsonIndent', () => {
  it('detects 2-space, 4-space, and tab indentation', () => {
    expect(detectJsonIndent('{\n  "a": 1\n}')).toBe(2);
    expect(detectJsonIndent('{\n    "a": 1\n}')).toBe(4);
    expect(detectJsonIndent('{\n\t"a": 1\n}')).toBe('\t');
  });
});

describe('setDependencyRange', () => {
  it('updates an existing entry without mutating the input', () => {
    const input = { dependencies: { lodash: '^4.17.20' } };
    const out = setDependencyRange(input, 'dependencies', 'lodash', '^4.17.21');
    expect(out.dependencies).toEqual({ lodash: '^4.17.21' });
    expect(input.dependencies.lodash).toBe('^4.17.20'); // unchanged
  });
});

describe('applyFix', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-patch-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('edits the manifest range and invokes the lockfile regenerator', async () => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.20' } }, null, 2) + '\n',
    );
    const { runner, calls } = recordingRunner();

    const result = await applyFix(makePlan(), { root, runner });

    expect(result.manifestChanged).toBe(true);
    expect(result.lockfile.regenerated).toBe(true);
    expect(calls).toEqual([{ cwd: root, manager: 'npm' }]);

    const written = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(written.dependencies.lodash).toBe('^4.17.21');
  });

  it('preserves indentation and trailing newline', async () => {
    const original =
      '{\n    "name": "demo",\n    "dependencies": {\n        "lodash": "^4.17.20"\n    }\n}\n';
    await writeFile(join(root, 'package.json'), original);
    const { runner } = recordingRunner();

    const result = await applyFix(makePlan(), { root, runner });

    expect(result.manifestAfter.startsWith('{\n    "name"')).toBe(true); // 4-space kept
    expect(result.manifestAfter.endsWith('}\n')).toBe(true);
  });

  it('reports a failed lockfile regeneration without throwing', async () => {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.20' } }, null, 2),
    );
    const failing: PackageManagerRunner = {
      regenerateLockfile: async ({ manager }) => ({
        ok: false,
        command: `${manager} install`,
        stdout: '',
        stderr: 'boom',
      }),
    };

    const result = await applyFix(makePlan(), { root, runner: failing });
    expect(result.manifestChanged).toBe(true);
    expect(result.lockfile.regenerated).toBe(false);
    expect(result.lockfile.error).toBe('boom');
  });

  it('rejects a manifest path that escapes the workspace', async () => {
    const { runner } = recordingRunner();
    await expect(
      applyFix(makePlan({ manifestPath: '../evil.json' }), { root, runner }),
    ).rejects.toThrow(/escapes workspace/);
  });
});
