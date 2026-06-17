import { readFile } from 'node:fs/promises';
import type { DependencyFinding } from '@spiderwebs/schema';
import { resolveTarget, resolveWithin } from '../ingest.js';
import { defaultGitRunner, fixBranchName, fixCommitMessage, type GitRunner } from './git.js';
import {
  buildPrBody,
  buildPrTitle,
  defaultGitHubCli,
  forkCloneUrl,
  parseRepoCoordinates,
  type GitHubCli,
} from './github.js';
import { applyFix, type PackageManagerRunner } from './patcher.js';
import {
  combineFixPlans,
  manifestPathForLockfile,
  planFix,
  type FixPlan,
  type FixSkipReason,
} from './planner.js';
import { prepareFixWorkspace, type Cloner } from './workspace.js';

/** Step labels surfaced as progress while a fix runs. */
export type FixStep = 'workspace' | 'plan' | 'patch' | 'commit' | 'fork' | 'push' | 'pr';

export type FixEvent =
  | { type: 'fix:step'; step: FixStep; message: string }
  /** Fine-grained activity line (clone progress, the manifest edit, npm output…). */
  | { type: 'fix:log'; message: string }
  | { type: 'fix:done'; status: FixStatus; message: string }
  | { type: 'fix:error'; message: string };

/** What the consent callback is shown before any push/fork/PR happens. */
export interface FixConsentSummary {
  target: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  branch: string;
  prTitle: string;
  diff: string;
}

export type FixStatus =
  | 'opened-pr'
  | 'updated-pr'
  | 'committed' // committed locally; consent withheld or no GitHub target
  | 'dry-run'
  | 'gh-unavailable'
  | 'skipped'
  | 'error';

export interface RunFixResult {
  status: FixStatus;
  message: string;
  plan?: FixPlan;
  branch?: string;
  prUrl?: string;
  diff?: string;
  /** Set when the workspace is retained (for inspection or manual follow-up). */
  workspacePath?: string;
  skipped?: { reason: FixSkipReason | 'no-changes' | 'no-findings'; detail: string };
}

export interface RunFixOptions {
  target: string;
  /** Findings to fix; only those matching the first finding's package are used (one PR per package). */
  findings: readonly DependencyFinding[];
  cwd?: string;
  ref?: string;
  keep?: boolean;
  offline?: boolean;
  /** Do everything except push/fork/PR; report the diff and intended PR. */
  dryRun?: boolean;
  /** Non-interactive consent for the push/PR boundary. */
  yes?: boolean;
  /** Interactive consent (used when `yes` is not set). */
  confirm?: (summary: FixConsentSummary) => Promise<boolean>;
  // Injectable side effects (defaults are the real implementations).
  git?: GitRunner;
  github?: GitHubCli;
  runner?: PackageManagerRunner;
  cloner?: Cloner;
  onEvent?: (event: FixEvent) => void;
}

/**
 * Guided remediation for one package (PRD §5.11). Composes workspace → plan →
 * patch → branch/commit, then — only after an explicit consent gate — routes a
 * push (forking when the user lacks write access) and opens/locates a PR via the
 * `gh` CLI. Nothing leaves the machine without consent; `dryRun` stops at the gate.
 */
export async function runFix(options: RunFixOptions): Promise<RunFixResult> {
  const emit = (event: FixEvent): void => options.onEvent?.(event);
  const log = (message: string): void => emit({ type: 'fix:log', message });
  const git = options.git ?? defaultGitRunner;
  const github = options.github ?? defaultGitHubCli;

  const first = options.findings[0];
  if (!first) {
    return {
      status: 'skipped',
      message: 'no findings provided',
      skipped: { reason: 'no-findings', detail: '' },
    };
  }
  const packageName = first.component.name;
  const findings = options.findings.filter((f) => f.component.name === packageName);

  const target = resolveTarget(options.target, options.cwd);

  emit({ type: 'fix:step', step: 'workspace', message: 'preparing throwaway clone' });
  const workspace = await prepareFixWorkspace(target, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.ref ? { ref: options.ref } : {}),
    ...(options.keep ? { keep: options.keep } : {}),
    ...(options.offline ? { offline: options.offline } : {}),
    ...(options.cloner ? { cloner: options.cloner } : {}),
    onLog: log,
  });
  log(`workspace: ${workspace.root}${workspace.reused ? ' (reused)' : ''}`);

  let retainWorkspace = false;
  const done = (result: RunFixResult): RunFixResult => {
    emit({ type: 'fix:done', status: result.status, message: result.message });
    // Report the path whenever the clone still exists on disk.
    const retained = retainWorkspace || Boolean(options.keep);
    return retained ? { ...result, workspacePath: workspace.root } : result;
  };

  try {
    // --- plan ---
    emit({ type: 'fix:step', step: 'plan', message: `planning fix for ${packageName}` });
    const manifestRel = manifestPathForLockfile(first.component.manifestPath);
    const manifestAbs = resolveWithin(workspace.root, manifestRel);
    const pkgJson = JSON.parse(await readFile(manifestAbs, 'utf8')) as Record<string, unknown>;

    const plans: FixPlan[] = [];
    let lastSkip: { reason: FixSkipReason; detail: string } | undefined;
    for (const finding of findings) {
      const result = planFix(finding, pkgJson);
      if (result.status === 'planned') plans.push(result.plan);
      else lastSkip = { reason: result.reason, detail: result.detail };
    }
    if (plans.length === 0) {
      retainWorkspace = false;
      await workspace.cleanup();
      return done({
        status: 'skipped',
        message: lastSkip ? `skipped: ${lastSkip.detail}` : 'nothing to fix',
        ...(lastSkip ? { skipped: lastSkip } : {}),
      });
    }
    const plan = combineFixPlans(plans);

    // --- patch ---
    emit({
      type: 'fix:step',
      step: 'patch',
      message: `bump ${plan.packageName} ${plan.fromVersion} → ${plan.toVersion}`,
    });
    await applyFix(plan, {
      root: workspace.root,
      ...(options.runner ? { runner: options.runner } : {}),
      onLog: log,
    });

    // --- branch + commit ---
    const branch = fixBranchName(plan.packageName, plan.toVersion);
    emit({ type: 'fix:step', step: 'commit', message: `committing on ${branch}` });
    log(`branch: ${branch}`);
    const branchExists = await git.hasLocalBranch(workspace.root, branch);
    await git.switchToBranch(workspace.root, branch, !branchExists);
    await git.stageAll(workspace.root);
    const diff = await git.diffStaged(workspace.root);
    const changedFiles = diff
      .split('\n')
      .filter((l) => l.startsWith('+++ b/'))
      .map((l) => l.slice('+++ b/'.length));
    if (changedFiles.length) log(`staged changes in: ${changedFiles.join(', ')}`);
    if (!diff.trim()) {
      retainWorkspace = false;
      await workspace.cleanup();
      return done({
        status: 'skipped',
        message: 'the fix produced no changes',
        plan,
        branch,
        skipped: { reason: 'no-changes', detail: 'manifest/lockfile already up to date' },
      });
    }
    await git.commit(
      workspace.root,
      fixCommitMessage({
        packageName: plan.packageName,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        advisoryIds: plan.resolvesAdvisoryIds,
        findingIds: plan.resolvesFindingIds,
      }),
    );
    log(`committed ${plan.packageName}@${plan.toVersion} on ${branch}`);

    const prTitle = buildPrTitle(plan);

    // --- consent boundary: nothing below pushes without explicit consent ---
    if (options.dryRun) {
      retainWorkspace = true;
      return done({
        status: 'dry-run',
        message: 'dry run — committed in the workspace; would push and open a PR',
        plan,
        branch,
        diff,
      });
    }

    const coords = parseRepoCoordinates(target);
    if (!coords) {
      retainWorkspace = true;
      return done({
        status: 'committed',
        message: 'committed locally; no GitHub repository detected for this target',
        plan,
        branch,
        diff,
      });
    }

    const consentSummary: FixConsentSummary = {
      target: options.target,
      packageName: plan.packageName,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      branch,
      prTitle,
      diff,
    };
    const consented =
      options.yes === true || (options.confirm ? await options.confirm(consentSummary) : false);
    if (!consented) {
      retainWorkspace = true;
      return done({
        status: 'committed',
        message: 'committed in the workspace; consent for push/PR was not granted',
        plan,
        branch,
        diff,
      });
    }

    // --- gh availability (after consent, before any network mutation) ---
    if (!(await github.isAvailable())) {
      retainWorkspace = true;
      return done({
        status: 'gh-unavailable',
        message: 'GitHub CLI (`gh`) not found — install it to push and open a PR',
        plan,
        branch,
        diff,
      });
    }
    if (!(await github.isAuthenticated())) {
      retainWorkspace = true;
      return done({
        status: 'gh-unavailable',
        message: 'GitHub CLI is not authenticated — run `gh auth login`',
        plan,
        branch,
        diff,
      });
    }

    // --- route the push (direct when writable, else fork) ---
    const view = await github.viewRepo(coords);
    let pushRemote = 'origin';
    let head = branch;
    if (!view?.viewerCanPush) {
      emit({ type: 'fix:step', step: 'fork', message: 'forking (no push access to the target)' });
      const fork = await github.fork(coords);
      await git.ensureRemote(workspace.root, 'spiderwebs-fork', forkCloneUrl(fork));
      pushRemote = 'spiderwebs-fork';
      head = `${fork.owner}:${branch}`;
    }

    emit({ type: 'fix:step', step: 'push', message: `pushing ${branch} → ${pushRemote}` });
    try {
      await git.push(workspace.root, pushRemote, branch);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `git push failed: ${detail}. If this is an auth problem, run \`gh auth setup-git\` ` +
          `so git can use your GitHub CLI credentials.`,
      );
    }

    // --- open or locate the PR (idempotent) ---
    emit({ type: 'fix:step', step: 'pr', message: 'opening pull request' });
    const existing = await github.findPr(coords, head);
    if (existing) {
      if (!options.keep) await workspace.cleanup();
      return done({
        status: 'updated-pr',
        message: `updated existing pull request ${existing.url}`,
        plan,
        branch,
        prUrl: existing.url,
      });
    }
    const pr = await github.createPr({
      repo: coords,
      head,
      base: view?.defaultBranch ?? 'main',
      title: prTitle,
      body: buildPrBody(plan),
    });
    if (!options.keep) await workspace.cleanup();
    return done({
      status: 'opened-pr',
      message: `opened pull request ${pr.url}`,
      plan,
      branch,
      prUrl: pr.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'fix:error', message });
    if (!options.keep) await workspace.cleanup().catch(() => {});
    return { status: 'error', message };
  }
}
