import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dependencyFindingId, type DependencyFinding } from '@spiderwebs/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRunner } from '../src/fix/git.js';
import type { GitHubCli, PullRequest, RepoView } from '../src/fix/github.js';
import type { PackageManagerRunner } from '../src/fix/patcher.js';
import { runFix } from '../src/fix/runFix.js';
import type { Cloner } from '../src/fix/workspace.js';

function makeFinding(
  over: Partial<{ name: string; version: string; direct: boolean; fixed: string[] }> = {},
): DependencyFinding {
  const name = over.name ?? 'lodash';
  const version = over.version ?? '4.17.20';
  const purl = `pkg:npm/${name}@${version}`;
  const advisoryId = 'GHSA-35jh-r3h4-6jhm';
  return {
    id: dependencyFindingId(purl, advisoryId),
    type: 'dependency',
    severity: 'high',
    title: `${name}@${version}`,
    component: {
      name,
      version,
      ecosystem: 'npm',
      purl,
      direct: over.direct ?? true,
      scope: 'runtime',
      pinned: true,
      manifestPath: 'package-lock.json',
      dependencyPaths: [[`${name}@${version}`]],
    },
    advisory: {
      id: advisoryId,
      aliases: ['CVE-2021-23337'],
      source: 'osv',
      summary: 's',
      severity: 'high',
      cwes: [],
      affectedRanges: [],
      fixedVersions: over.fixed ?? ['4.17.21'],
      references: [],
    },
    fixedVersions: over.fixed ?? ['4.17.21'],
    dependencyPath: [`${name}@${version}`],
  };
}

/** Cloner that materializes a minimal npm repo in the workspace. */
const fakeClone: Cloner = async ({ dir }) => {
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { lodash: '^4.17.20' } }, null, 2) + '\n',
  );
  await writeFile(join(dir, 'package-lock.json'), '{}\n');
};

const okRunner: PackageManagerRunner = {
  regenerateLockfile: async ({ manager }) => ({
    ok: true,
    command: `${manager} install`,
    stdout: '',
    stderr: '',
  }),
};

function makeGit(): GitRunner & { [K in keyof GitRunner]: ReturnType<typeof vi.fn> } {
  return {
    currentBranch: vi.fn(async () => 'main'),
    hasLocalBranch: vi.fn(async () => false),
    switchToBranch: vi.fn(async () => {}),
    stageAll: vi.fn(async () => {}),
    diffStaged: vi.fn(
      async () => 'diff --git a/package.json b/package.json\n+ "lodash": "^4.17.21"',
    ),
    commit: vi.fn(async () => {}),
    ensureRemote: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
  } as GitRunner & { [K in keyof GitRunner]: ReturnType<typeof vi.fn> };
}

function makeGitHub(over: Partial<Record<keyof GitHubCli, unknown>> = {}): GitHubCli & {
  [K in keyof GitHubCli]: ReturnType<typeof vi.fn>;
} {
  const view: RepoView = {
    nameWithOwner: 'acme/widgets',
    viewerCanPush: true,
    defaultBranch: 'main',
  };
  const base = {
    isAvailable: vi.fn(async () => true),
    isAuthenticated: vi.fn(async () => true),
    currentLogin: vi.fn(async () => 'me'),
    viewRepo: vi.fn(async () => view),
    fork: vi.fn(async () => ({ owner: 'me', repo: 'widgets' })),
    findPr: vi.fn(async (): Promise<PullRequest | undefined> => undefined),
    createPr: vi.fn(async () => ({ url: 'https://github.com/acme/widgets/pull/7', number: 7 })),
  };
  return { ...base, ...over } as GitHubCli & { [K in keyof GitHubCli]: ReturnType<typeof vi.fn> };
}

describe('runFix', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'sw-runfix-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const baseOpts = () => ({
    target: 'acme/widgets',
    findings: [makeFinding()],
    cwd,
    cloner: fakeClone,
    runner: okRunner,
  });

  it('dry-run commits locally but never pushes or opens a PR', async () => {
    const git = makeGit();
    const github = makeGitHub();
    const result = await runFix({ ...baseOpts(), dryRun: true, yes: true, git, github });

    expect(result.status).toBe('dry-run');
    expect(result.diff).toContain('lodash');
    expect(result.workspacePath).toBeTruthy();
    expect(git.commit).toHaveBeenCalledTimes(1);
    expect(git.push).not.toHaveBeenCalled();
    expect(github.fork).not.toHaveBeenCalled();
    expect(github.createPr).not.toHaveBeenCalled();
  });

  it('without consent, commits but does not push (guardrail)', async () => {
    const git = makeGit();
    const github = makeGitHub();
    // No `yes`, confirm returns false.
    const result = await runFix({ ...baseOpts(), confirm: async () => false, git, github });

    expect(result.status).toBe('committed');
    expect(git.commit).toHaveBeenCalledTimes(1);
    expect(git.push).not.toHaveBeenCalled();
    expect(github.createPr).not.toHaveBeenCalled();
  });

  it('with consent and push access, pushes to origin and opens a same-repo PR', async () => {
    const git = makeGit();
    const github = makeGitHub();
    const result = await runFix({ ...baseOpts(), yes: true, git, github });

    expect(result.status).toBe('opened-pr');
    expect(result.prUrl).toBe('https://github.com/acme/widgets/pull/7');
    expect(github.fork).not.toHaveBeenCalled();
    expect(git.push).toHaveBeenCalledWith(
      expect.any(String),
      'origin',
      expect.stringContaining('spiderwebs/fix-lodash'),
    );
    expect(github.createPr).toHaveBeenCalledTimes(1);
    const prArg = github.createPr.mock.calls[0]![0] as { head: string };
    expect(prArg.head).toBe('spiderwebs/fix-lodash-4.17.21'); // same-repo head (no fork prefix)
  });

  it('with consent but no push access, forks and opens a cross-fork PR', async () => {
    const git = makeGit();
    const github = makeGitHub({
      viewRepo: vi.fn(async () => ({
        nameWithOwner: 'acme/widgets',
        viewerCanPush: false,
        defaultBranch: 'main',
      })),
    });
    const result = await runFix({ ...baseOpts(), yes: true, git, github });

    expect(result.status).toBe('opened-pr');
    expect(github.fork).toHaveBeenCalledTimes(1);
    expect(git.ensureRemote).toHaveBeenCalledWith(
      expect.any(String),
      'spiderwebs-fork',
      expect.stringContaining('me/widgets'),
    );
    expect(git.push).toHaveBeenCalledWith(
      expect.any(String),
      'spiderwebs-fork',
      expect.any(String),
    );
    const prArg = github.createPr.mock.calls[0]![0] as { head: string };
    expect(prArg.head).toBe('me:spiderwebs/fix-lodash-4.17.21'); // cross-fork head
  });

  it('is idempotent: an existing PR is reported as updated, not duplicated', async () => {
    const git = makeGit();
    const github = makeGitHub({
      findPr: vi.fn(async () => ({ url: 'https://github.com/acme/widgets/pull/3', number: 3 })),
    });
    const result = await runFix({ ...baseOpts(), yes: true, git, github });

    expect(result.status).toBe('updated-pr');
    expect(result.prUrl).toBe('https://github.com/acme/widgets/pull/3');
    expect(github.createPr).not.toHaveBeenCalled();
  });

  it('degrades gracefully when gh is unavailable (after consent)', async () => {
    const git = makeGit();
    const github = makeGitHub({ isAvailable: vi.fn(async () => false) });
    const result = await runFix({ ...baseOpts(), yes: true, git, github });

    expect(result.status).toBe('gh-unavailable');
    expect(result.workspacePath).toBeTruthy(); // retained so the user can act
    expect(git.push).not.toHaveBeenCalled();
  });

  it('skips a transitive finding without patching or committing', async () => {
    const git = makeGit();
    const github = makeGitHub();
    const result = await runFix({
      ...baseOpts(),
      findings: [makeFinding({ direct: false })],
      yes: true,
      git,
      github,
    });

    expect(result.status).toBe('skipped');
    expect(result.skipped?.reason).toBe('transitive');
    expect(git.commit).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalled();
  });
});
