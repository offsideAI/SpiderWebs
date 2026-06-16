import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ResolvedTarget } from '../ingest.js';
import type { FixPlan } from './planner.js';

const execFileAsync = promisify(execFile);

export interface RepoCoordinates {
  owner: string;
  repo: string;
}

export interface RepoView {
  nameWithOwner: string;
  /** True when the authenticated user can push to this repo (no fork needed). */
  viewerCanPush: boolean;
  defaultBranch: string;
}

export interface PullRequest {
  url: string;
  number: number;
}

export interface CreatePrInput {
  /** Upstream repo the PR targets. */
  repo: RepoCoordinates;
  /** Head ref — `branch` for same-repo, `login:branch` for a cross-fork PR. */
  head: string;
  base: string;
  title: string;
  body: string;
}

/**
 * GitHub operations for the remediation workflow, delegated to the user's
 * authenticated `gh` CLI (PRD §5.11 / §6). SpiderWebs handles no GitHub
 * credentials of its own. Behind an interface so the orchestrator is testable.
 */
export interface GitHubCli {
  isAvailable(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  /** Current authenticated login, or undefined if unavailable. */
  currentLogin(): Promise<string | undefined>;
  viewRepo(coords: RepoCoordinates): Promise<RepoView | undefined>;
  /** Fork the repo to the user's account; returns the fork's coordinates. */
  fork(coords: RepoCoordinates): Promise<RepoCoordinates>;
  /** Find an existing open PR from `head` into the repo (idempotency). */
  findPr(coords: RepoCoordinates, head: string): Promise<PullRequest | undefined>;
  createPr(input: CreatePrInput): Promise<PullRequest>;
}

interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function gh(args: string[]): Promise<GhResult> {
  try {
    const { stdout, stderr } = await execFileAsync('gh', args, { maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' };
  }
}

export const defaultGitHubCli: GitHubCli = {
  async isAvailable() {
    return (await gh(['--version'])).ok;
  },
  async isAuthenticated() {
    return (await gh(['auth', 'status'])).ok;
  },
  async currentLogin() {
    const res = await gh(['api', 'user', '--jq', '.login']);
    return res.ok ? res.stdout.trim() || undefined : undefined;
  },
  async viewRepo(coords) {
    const res = await gh([
      'repo',
      'view',
      `${coords.owner}/${coords.repo}`,
      '--json',
      'nameWithOwner,viewerPermission,defaultBranchRef',
    ]);
    if (!res.ok) return undefined;
    const data = JSON.parse(res.stdout) as {
      nameWithOwner: string;
      viewerPermission?: string;
      defaultBranchRef?: { name?: string } | null;
    };
    const canPush = ['ADMIN', 'MAINTAIN', 'WRITE'].includes(data.viewerPermission ?? '');
    return {
      nameWithOwner: data.nameWithOwner,
      viewerCanPush: canPush,
      defaultBranch: data.defaultBranchRef?.name ?? 'main',
    };
  },
  async fork(coords) {
    const res = await gh(['repo', 'fork', `${coords.owner}/${coords.repo}`, '--clone=false']);
    if (!res.ok) throw new Error(`gh repo fork failed: ${res.stderr}`);
    const login = await this.currentLogin();
    if (!login) throw new Error('could not determine the authenticated GitHub login after fork');
    return { owner: login, repo: coords.repo };
  },
  async findPr(coords, head) {
    const res = await gh([
      'pr',
      'list',
      '--repo',
      `${coords.owner}/${coords.repo}`,
      '--head',
      head,
      '--state',
      'open',
      '--json',
      'url,number',
    ]);
    if (!res.ok) return undefined;
    const list = JSON.parse(res.stdout) as PullRequest[];
    return list[0];
  },
  async createPr(input) {
    const res = await gh([
      'pr',
      'create',
      '--repo',
      `${input.repo.owner}/${input.repo.repo}`,
      '--head',
      input.head,
      '--base',
      input.base,
      '--title',
      input.title,
      '--body',
      input.body,
    ]);
    if (!res.ok) throw new Error(`gh pr create failed: ${res.stderr}`);
    const url = res.stdout.trim().split('\n').pop() ?? '';
    const number = Number.parseInt(url.split('/').pop() ?? '0', 10) || 0;
    return { url, number };
  },
};

/** Parse GitHub owner/repo from a resolved target (undefined for non-GitHub). */
export function parseRepoCoordinates(target: ResolvedTarget): RepoCoordinates | undefined {
  const source = target.url ?? target.cloneUrl ?? target.raw;
  const match = source.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return undefined;
  return { owner: match[1]!, repo: match[2]! };
}

export function forkCloneUrl(coords: RepoCoordinates): string {
  return `https://github.com/${coords.owner}/${coords.repo}.git`;
}

export function buildPrTitle(plan: FixPlan): string {
  return `fix(deps): bump ${plan.packageName} from ${plan.fromVersion} to ${plan.toVersion}`;
}

export function buildPrBody(plan: FixPlan): string {
  const advisories = plan.resolvesAdvisoryIds.length
    ? plan.resolvesAdvisoryIds.map((id) => `- ${id}`).join('\n')
    : '- (known advisories)';
  const breaking =
    plan.rangeRewritten || plan.toVersion.split('.')[0] !== plan.fromVersion.split('.')[0]
      ? '\n> ⚠️ This crosses a major version or rewrote a complex range — review for breaking changes before merging.\n'
      : '';
  return (
    `## SpiderWebs dependency fix\n\n` +
    `Upgrades **${plan.packageName}** \`${plan.fromVersion}\` → \`${plan.toVersion}\` ` +
    `(manifest \`${plan.currentRange}\` → \`${plan.newRange}\`) and regenerates the lockfile.\n\n` +
    `### Resolves\n${advisories}\n${breaking}\n` +
    `---\n_Opened automatically by [SpiderWebs](https://github.com/) — a defensive security ` +
    `auditor. Review and merge at your discretion._\n`
  );
}
