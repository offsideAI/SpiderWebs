import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { IngestError, type ResolvedTarget } from '../ingest.js';
import { FIX_GIT_OPTIONS } from './git.js';

/** Directory (inside the user's cwd) that holds throwaway fix clones. */
export const WORKSPACE_DIR = '.spiderwebs-workspace';

/** A short, filesystem-safe slug identifying the target repo. */
export function fixWorkspaceSlug(target: ResolvedTarget): string {
  const source = target.url ?? target.cloneUrl ?? target.localPath ?? target.raw;
  const cleaned = source
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/\.git$/, '')
    .replace(/^github\.com[/:]/, '');
  const parts = cleaned.split(/[/:\\]/).filter(Boolean);
  const tail = parts.slice(-2).join('-') || 'repo';
  return tail.replace(/[^\w.-]/g, '-').toLowerCase();
}

export function fixWorkspaceRoot(cwd: string, slug: string): string {
  return join(cwd, WORKSPACE_DIR, slug);
}

/** Injectable clone step so the workspace can be exercised without a network/git. */
export type Cloner = (input: {
  target: ResolvedTarget;
  dir: string;
  ref?: string;
  onLog?: (message: string) => void;
}) => Promise<void>;

const defaultCloner: Cloner = async ({ target, dir, ref, onLog }) => {
  const source = target.cloneUrl ?? target.localPath;
  if (!source) throw new IngestError(`cannot determine a clone source for ${target.raw}`);
  // Shallow, single-branch clone — fast even on large repos, and still pushable.
  const args = ['--depth', '1', '--single-branch', '--progress'];
  if (ref) args.push('--branch', ref);
  const git = simpleGit({
    ...FIX_GIT_OPTIONS,
    progress: ({ method, stage, progress }) => onLog?.(`${method} ${stage} ${progress}%`),
  });
  await git.clone(source, dir, args);
};

export interface FixWorkspaceOptions {
  cwd?: string;
  ref?: string;
  /** Keep the clone on disk after cleanup() (default: remove it). */
  keep?: boolean;
  /** Forbid network — a remote target without an existing clone becomes an error. */
  offline?: boolean;
  /** Override the clone step (tests). */
  cloner?: Cloner;
  /** Receives fine-grained progress lines (clone progress, paths…). */
  onLog?: (message: string) => void;
}

export interface FixWorkspace {
  root: string;
  slug: string;
  /** True when an existing clone was reused rather than freshly cloned. */
  reused: boolean;
  cleanup: () => Promise<void>;
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/**
 * Materialize a throwaway clone of the target under `./.spiderwebs-workspace/<slug>/`
 * (PRD §5.11 step 1). The user's own working tree is never touched. The workspace
 * directory carries a `.gitignore` of `*`, so if the cwd is itself a repo the clone
 * is never accidentally committed.
 */
export async function prepareFixWorkspace(
  target: ResolvedTarget,
  options: FixWorkspaceOptions = {},
): Promise<FixWorkspace> {
  const cwd = options.cwd ?? process.cwd();
  const slug = fixWorkspaceSlug(target);
  const baseDir = join(cwd, WORKSPACE_DIR);
  const root = fixWorkspaceRoot(cwd, slug);

  const log = options.onLog ?? ((): void => {});

  await mkdir(baseDir, { recursive: true });
  // Make the workspace invisible to any repo rooted at cwd.
  await writeFile(join(baseDir, '.gitignore'), '*\n', 'utf8').catch(() => {});

  const cleanup = async (): Promise<void> => {
    if (!options.keep) await rm(root, { recursive: true, force: true });
  };

  if (await isDirectory(join(root, '.git'))) {
    log(`reusing existing clone at ${root}`);
    return { root, slug, reused: true, cleanup };
  }

  if (options.offline) {
    throw new IngestError(`no existing clone for ${slug} and --offline forbids cloning`);
  }

  // Clone fresh into a clean directory.
  await rm(root, { recursive: true, force: true });
  const cloner = options.cloner ?? defaultCloner;
  const source = target.cloneUrl ?? target.localPath ?? target.raw;
  log(`cloning ${source} into ${root} (shallow)…`);
  try {
    await cloner({ target, dir: root, onLog: log, ...(options.ref ? { ref: options.ref } : {}) });
    log('clone complete');
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw new IngestError(
      `failed to clone ${target.raw} into ${root}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { root, slug, reused: false, cleanup };
}
