import { createInterface } from 'node:readline';
import { EventBus } from '@spiderwebs/core/bus';
import { ExitCode } from '@spiderwebs/core';
import {
  runFix as realRunFix,
  runScan as realRunScan,
  type FixConsentSummary,
  type RunFixResult,
} from '@spiderwebs/scanner';
import type { DependencyFinding } from '@spiderwebs/schema';
import type { CliContext } from './context.js';

export interface FixCommandOptions {
  target: string;
  finding?: string;
  allDirect?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  keep?: boolean;
  offline?: boolean;
}

/** Injectable side effects so the command is unit-testable without network/git. */
export interface FixCommandDeps {
  runScan: typeof realRunScan;
  runFix: typeof realRunFix;
  /** Interactive consent prompt (skipped when `--yes`). */
  confirm: (summary: FixConsentSummary) => Promise<boolean>;
}

/** A readline-backed yes/no prompt that prints the diff first. */
export function makeInteractiveConfirm(ctx: CliContext): FixCommandDeps['confirm'] {
  return (summary) =>
    new Promise((resolve) => {
      ctx.stdout.write(`\n${summary.diff}\n`);
      ctx.stdout.write(
        `About to push branch "${summary.branch}" and open a PR to ${summary.target}.\n`,
      );
      const rl = createInterface({ input: process.stdin, output: ctx.stdout });
      rl.question('Proceed? [y/N] ', (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });
}

export function defaultFixDeps(ctx: CliContext): FixCommandDeps {
  return { runScan: realRunScan, runFix: realRunFix, confirm: makeInteractiveConfirm(ctx) };
}

function selectFindings(
  findings: readonly DependencyFinding[],
  options: FixCommandOptions,
): { selected: DependencyFinding[]; error?: string } {
  if (options.finding) {
    const selected = findings.filter((f) => f.id === options.finding);
    if (selected.length === 0)
      return { selected: [], error: `no finding with id ${options.finding}` };
    return { selected };
  }
  // Default (and --all-direct): every direct dependency with an available fix.
  return { selected: findings.filter((f) => f.component.direct && f.fixedVersions.length > 0) };
}

/** Group findings by package name (one PR per package). */
function groupByPackage(findings: readonly DependencyFinding[]): Map<string, DependencyFinding[]> {
  const groups = new Map<string, DependencyFinding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.component.name);
    if (bucket) bucket.push(finding);
    else groups.set(finding.component.name, [finding]);
  }
  return groups;
}

/**
 * `spiderwebs fix` — scan the target, then drive guided remediation per package
 * (PRD §5.11). Never pushes without consent: `--dry-run` stops before the push,
 * and otherwise the user must confirm (or pass `--yes`).
 */
export async function runFixCommand(
  ctx: CliContext,
  options: FixCommandOptions,
  deps: FixCommandDeps,
): Promise<ExitCode> {
  const bus = new EventBus();
  const scan = await deps.runScan(
    {
      target: options.target,
      cwd: ctx.cwd,
      ...(options.offline ? { offline: options.offline } : {}),
    },
    bus,
  );

  const dependencyFindings = scan.report.findings.filter(
    (f): f is DependencyFinding => f.type === 'dependency',
  );
  const { selected, error } = selectFindings(dependencyFindings, options);
  if (error) {
    ctx.stderr.write(`spiderwebs: ${error}\n`);
    return ExitCode.ToolError;
  }
  if (selected.length === 0) {
    ctx.stdout.write('No fixable direct-dependency findings.\n');
    return ExitCode.Clean;
  }

  const groups = groupByPackage(selected);
  ctx.stdout.write(`Fixing ${groups.size} package(s)${options.dryRun ? ' (dry run)' : ''}...\n`);

  let hadError = false;
  let openedOrWould = 0;
  for (const [pkg, findings] of groups) {
    const result: RunFixResult = await deps.runFix({
      target: options.target,
      findings,
      cwd: ctx.cwd,
      ...(options.dryRun ? { dryRun: options.dryRun } : {}),
      ...(options.yes ? { yes: options.yes } : {}),
      ...(options.keep ? { keep: options.keep } : {}),
      ...(options.offline ? { offline: options.offline } : {}),
      confirm: deps.confirm,
    });
    ctx.stdout.write(`  ${pkg}: ${result.status} — ${result.message}\n`);
    if (result.prUrl) ctx.stdout.write(`    ${result.prUrl}\n`);
    if (result.status === 'error') hadError = true;
    if (
      result.status === 'opened-pr' ||
      result.status === 'updated-pr' ||
      result.status === 'dry-run'
    ) {
      openedOrWould += 1;
    }
  }

  if (hadError) return ExitCode.ToolError;
  // Findings remain at/above any gate until a PR is actually merged, but the fix
  // command's own success is "did it run cleanly", so a clean run exits 0.
  void openedOrWould;
  return ExitCode.Clean;
}
