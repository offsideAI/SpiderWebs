import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import type { Ecosystem } from '@spiderwebs/schema';

export type TargetKind = 'local' | 'remote';

export interface ResolvedTarget {
  /** The raw target as supplied by the user. */
  raw: string;
  kind: TargetKind;
  /** Absolute local path (local targets) — the directory to scan. */
  localPath?: string;
  /** Clone URL (remote targets). */
  cloneUrl?: string;
  /** Display URL for the report, when known. */
  url?: string;
}

export class IngestError extends Error {
  override name = 'IngestError';
}

const ORG_REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * Classify a target into a local path or a remote clone URL (PRD §5.1).
 * Accepts: local paths, `org/repo` shorthand, https/git/ssh URLs.
 */
export function resolveTarget(raw: string, cwd: string = process.cwd()): ResolvedTarget {
  const trimmed = raw.trim();

  if (
    trimmed === '.' ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    isAbsolute(trimmed)
  ) {
    return { raw, kind: 'local', localPath: resolve(cwd, trimmed.replace(/^~(?=\/|$)/, '')) };
  }

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('git@') ||
    trimmed.endsWith('.git')
  ) {
    return { raw, kind: 'remote', cloneUrl: trimmed, url: httpUrlFor(trimmed) };
  }

  if (ORG_REPO.test(trimmed)) {
    const url = `https://github.com/${trimmed}`;
    return { raw, kind: 'remote', cloneUrl: `${url}.git`, url };
  }

  // Fall back to treating it as a local path; existence is checked later.
  return { raw, kind: 'local', localPath: resolve(cwd, trimmed) };
}

function httpUrlFor(cloneUrl: string): string | undefined {
  const ssh = cloneUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  if (cloneUrl.startsWith('http')) return cloneUrl.replace(/\.git$/, '');
  return undefined;
}

export interface Workspace {
  /** Absolute root directory containing the repository files. */
  root: string;
  target: ResolvedTarget;
  commit?: string;
  /** Remove any temp clone; a no-op for local targets (unless --keep is implied). */
  cleanup: () => Promise<void>;
}

export interface PrepareOptions {
  cwd?: string;
  /** Branch or tag to clone (remote only). */
  ref?: string;
  /** Keep a cloned workspace on disk after cleanup() (debugging). */
  keep?: boolean;
  /** Forbid network — remote targets become an error (PRD §5.1, --offline). */
  offline?: boolean;
}

/**
 * Produce a workspace to scan. Local targets are used in place (read-only);
 * remote targets are shallow-cloned into a temp dir. Repo code is NEVER
 * executed or built — we only read manifests as data (PRD §12).
 */
export async function prepareWorkspace(
  target: ResolvedTarget,
  options: PrepareOptions = {},
): Promise<Workspace> {
  if (target.kind === 'local') {
    const root = target.localPath!;
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new IngestError(`local target is not a directory: ${root}`);
    }
    return { root, target, cleanup: async () => {} };
  }

  if (options.offline) {
    throw new IngestError(`cannot clone ${target.cloneUrl} in --offline mode`);
  }

  const dir = await mkdtemp(join(tmpdir(), 'spiderwebs-'));
  try {
    const git = simpleGit();
    const cloneArgs = ['--depth', '1', '--single-branch'];
    if (options.ref) cloneArgs.push('--branch', options.ref);
    await git.clone(target.cloneUrl!, dir, cloneArgs);
    const commit = await simpleGit(dir)
      .revparse(['HEAD'])
      .catch(() => undefined);
    return {
      root: dir,
      target,
      ...(commit ? { commit: commit.trim() } : {}),
      cleanup: async () => {
        if (!options.keep) await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw new IngestError(
      `failed to clone ${target.cloneUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolve a repo-relative path inside the workspace, rejecting traversal and
 * absolute escapes (zip-slip / `../` guard, PRD §12).
 */
export function resolveWithin(root: string, relPath: string): string {
  const resolved = resolve(root, relPath);
  const rel = relative(root, resolved);
  if (rel === '') return resolved;
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new IngestError(`path escapes workspace: ${relPath}`);
  }
  return resolved;
}

export interface ManifestFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Forward-slash repo-relative path (stable across platforms). */
  relPath: string;
  ecosystem: Ecosystem;
  kind: ManifestKind;
}

export type ManifestKind = 'npm-lock' | 'pnpm-lock' | 'yarn-lock';

const MANIFEST_NAMES: Record<string, { ecosystem: Ecosystem; kind: ManifestKind }> = {
  'package-lock.json': { ecosystem: 'npm', kind: 'npm-lock' },
  'npm-shrinkwrap.json': { ecosystem: 'npm', kind: 'npm-lock' },
  'pnpm-lock.yaml': { ecosystem: 'npm', kind: 'pnpm-lock' },
  'yarn.lock': { ecosystem: 'npm', kind: 'yarn-lock' },
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage']);

/** Walk the workspace (depth-bounded) to find supported lockfiles (PRD §5.2). */
export async function discoverManifests(
  root: string,
  options: { subdir?: string; maxDepth?: number } = {},
): Promise<ManifestFile[]> {
  const { readdir } = await import('node:fs/promises');
  const start = options.subdir ? resolveWithin(root, options.subdir) : root;
  const maxDepth = options.maxDepth ?? 6;
  const found: ManifestFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const match = MANIFEST_NAMES[entry.name];
        if (!match) continue;
        const absPath = join(dir, entry.name);
        found.push({
          absPath,
          relPath: relative(root, absPath).split(sep).join('/'),
          ecosystem: match.ecosystem,
          kind: match.kind,
        });
      }
    }
  }

  await walk(start, 0);
  // Deterministic order so reports diff cleanly.
  found.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return found;
}
