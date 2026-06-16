import { Writable } from 'node:stream';
import { ExitCode } from '@spiderwebs/core';
import {
  dependencyFindingId,
  summarizeFindings,
  type DependencyFinding,
  type Report,
} from '@spiderwebs/schema';
import type { RunFixResult } from '@spiderwebs/scanner';
import { describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/context.js';
import { runFixCommand, type FixCommandDeps, type FixCommandOptions } from '../src/fixCommand.js';

class MemorySink extends Writable {
  data = '';
  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.data += chunk.toString();
    cb();
  }
}

function makeFinding(name: string, direct: boolean, fixed: string[]): DependencyFinding {
  const purl = `pkg:npm/${name}@1.0.0`;
  const advisoryId = `GHSA-${name}`;
  return {
    id: dependencyFindingId(purl, advisoryId),
    type: 'dependency',
    severity: 'high',
    title: `${name}@1.0.0`,
    component: {
      name,
      version: '1.0.0',
      ecosystem: 'npm',
      purl,
      direct,
      scope: 'runtime',
      pinned: true,
      manifestPath: 'package-lock.json',
      dependencyPaths: [[`${name}@1.0.0`]],
    },
    advisory: {
      id: advisoryId,
      aliases: [],
      source: 'osv',
      summary: 's',
      severity: 'high',
      cwes: [],
      affectedRanges: [],
      fixedVersions: fixed,
      references: [],
    },
    fixedVersions: fixed,
    dependencyPath: [`${name}@1.0.0`],
  };
}

function makeReport(findings: DependencyFinding[]): Report {
  return {
    schemaVersion: 1,
    tool: { name: 'spiderwebs', version: '0.1.0' },
    repo: { target: 'acme/widgets' },
    scan: {
      startedAt: '2026-06-16T00:00:00.000Z',
      finishedAt: '2026-06-16T00:00:01.000Z',
      durationMs: 1000,
    },
    dataSources: [],
    summary: summarizeFindings(findings),
    components: [],
    findings,
    correlations: [],
    agent: { enabled: false },
  };
}

function makeCtx(): { ctx: CliContext; stdout: MemorySink; stderr: MemorySink } {
  const stdout = new MemorySink();
  const stderr = new MemorySink();
  return {
    ctx: { stdout, stderr, env: {}, cwd: '/tmp/x', exitCode: ExitCode.Clean },
    stdout,
    stderr,
  };
}

const fixable = [
  makeFinding('lodash', true, ['1.2.0']),
  makeFinding('minimist', true, ['1.2.6']),
  makeFinding('transitive-dep', false, ['2.0.0']),
  makeFinding('nofix', true, []),
];

function makeDeps(
  over: Partial<FixCommandDeps> = {},
  findings: DependencyFinding[] = fixable,
): { deps: FixCommandDeps; runFix: ReturnType<typeof vi.fn> } {
  const runFix = vi.fn(
    async (opts: { findings: readonly DependencyFinding[] }): Promise<RunFixResult> => ({
      status: 'opened-pr',
      message: 'opened PR',
      prUrl: `https://github.com/acme/widgets/pull/1`,
      branch: `spiderwebs/fix-${opts.findings[0]?.component.name}`,
    }),
  );
  const deps: FixCommandDeps = {
    runScan: vi.fn(async () => ({
      report: makeReport(findings),
      exitCode: ExitCode.FindingsAtThreshold,
    })),
    runFix: runFix as unknown as FixCommandDeps['runFix'],
    confirm: vi.fn(async () => true),
    ...over,
  };
  return { deps, runFix };
}

const opts = (o: Partial<FixCommandOptions> = {}): FixCommandOptions => ({
  target: 'acme/widgets',
  ...o,
});

describe('runFixCommand', () => {
  it('fixes every fixable direct dependency by default (one runFix per package)', async () => {
    const { ctx, stdout } = makeCtx();
    const { deps, runFix } = makeDeps();
    const code = await runFixCommand(ctx, opts(), deps);

    expect(code).toBe(ExitCode.Clean);
    // lodash + minimist are fixable direct; transitive + nofix are excluded.
    expect(runFix).toHaveBeenCalledTimes(2);
    const fixedPkgs = runFix.mock.calls.map(
      (c) => (c[0] as { findings: DependencyFinding[] }).findings[0]!.component.name,
    );
    expect(fixedPkgs.sort()).toEqual(['lodash', 'minimist']);
    expect(stdout.data).toContain('Fixing 2 package(s)');
    expect(stdout.data).toContain('pull/1');
  });

  it('passes dry-run through and labels the output', async () => {
    const { ctx, stdout } = makeCtx();
    const { deps, runFix } = makeDeps();
    await runFixCommand(ctx, opts({ dryRun: true }), deps);
    expect(stdout.data).toContain('(dry run)');
    expect((runFix.mock.calls[0]![0] as { dryRun?: boolean }).dryRun).toBe(true);
  });

  it('passes --yes through as non-interactive consent', async () => {
    const { ctx } = makeCtx();
    const { deps, runFix } = makeDeps();
    await runFixCommand(ctx, opts({ yes: true }), deps);
    expect((runFix.mock.calls[0]![0] as { yes?: boolean }).yes).toBe(true);
  });

  it('targets a single finding with --finding', async () => {
    const { ctx } = makeCtx();
    const { deps, runFix } = makeDeps();
    const id = fixable[0]!.id;
    await runFixCommand(ctx, opts({ finding: id }), deps);
    expect(runFix).toHaveBeenCalledTimes(1);
    expect((runFix.mock.calls[0]![0] as { findings: DependencyFinding[] }).findings[0]!.id).toBe(
      id,
    );
  });

  it('errors on an unknown --finding id', async () => {
    const { ctx, stderr } = makeCtx();
    const { deps, runFix } = makeDeps();
    const code = await runFixCommand(ctx, opts({ finding: 'sw-deadbeefdeadbeef' }), deps);
    expect(code).toBe(ExitCode.ToolError);
    expect(stderr.data).toContain('no finding with id');
    expect(runFix).not.toHaveBeenCalled();
  });

  it('reports cleanly when there is nothing fixable', async () => {
    const { ctx, stdout } = makeCtx();
    const { deps, runFix } = makeDeps({}, [makeFinding('transitive-dep', false, ['2.0.0'])]);
    const code = await runFixCommand(ctx, opts(), deps);
    expect(code).toBe(ExitCode.Clean);
    expect(stdout.data).toContain('No fixable direct-dependency findings');
    expect(runFix).not.toHaveBeenCalled();
  });

  it('returns a tool error when a fix errors', async () => {
    const { ctx } = makeCtx();
    const runFix = vi.fn(async (): Promise<RunFixResult> => ({ status: 'error', message: 'boom' }));
    const { deps } = makeDeps({ runFix: runFix as unknown as FixCommandDeps['runFix'] });
    const code = await runFixCommand(ctx, opts({ yes: true }), deps);
    expect(code).toBe(ExitCode.ToolError);
  });
});
