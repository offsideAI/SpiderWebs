import { spawn } from 'node:child_process';
import { readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { resolveWithin } from '../ingest.js';
import type { FixPlan, PackageManager } from './planner.js';

/**
 * The lockfile-regeneration command per manager. ALWAYS `--ignore-scripts`, and
 * lockfile-only where supported, so no `node_modules` is built and no repo
 * lifecycle/postinstall scripts ever run (§12 — the one sanctioned tool call).
 */
export const LOCKFILE_REGEN_ARGS: Record<PackageManager, string[]> = {
  npm: ['install', '--ignore-scripts', '--package-lock-only'],
  pnpm: ['install', '--ignore-scripts', '--lockfile-only'],
  // Berry; classic yarn has no lockfile-only mode and will be a best-effort no-op.
  yarn: ['install', '--ignore-scripts', '--mode=update-lockfile'],
};

export interface PmRegenInput {
  cwd: string;
  manager: PackageManager;
  /** Receives each line of package-manager output as it arrives. */
  onLog?: (message: string) => void;
}

export interface PmRegenResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
}

/** Side-effecting package-manager invocation, behind an interface so tests mock it. */
export interface PackageManagerRunner {
  regenerateLockfile(input: PmRegenInput): Promise<PmRegenResult>;
}

/** Real runner: spawns the package manager with scripts disabled, streaming output. */
export const defaultPackageManagerRunner: PackageManagerRunner = {
  regenerateLockfile({ cwd, manager, onLog }): Promise<PmRegenResult> {
    const args = LOCKFILE_REGEN_ARGS[manager];
    const command = `${manager} ${args.join(' ')}`;
    onLog?.(`$ ${command}`);
    return new Promise((resolve) => {
      const child = spawn(manager, args, {
        cwd,
        // Defense in depth: also disable scripts via env for tools that read it.
        env: { ...process.env, npm_config_ignore_scripts: 'true' },
      });
      let stdout = '';
      let stderr = '';
      const stream = (buf: Buffer, sink: (s: string) => void): void => {
        const text = buf.toString();
        sink(text);
        for (const line of text.split('\n')) {
          if (line.trim()) onLog?.(`${manager}: ${line.trim()}`);
        }
      };
      child.stdout.on('data', (b: Buffer) => stream(b, (s) => (stdout += s)));
      child.stderr.on('data', (b: Buffer) => stream(b, (s) => (stderr += s)));
      child.on('error', (error) =>
        resolve({ ok: false, command, stdout, stderr: stderr || error.message }),
      );
      child.on('close', (code) => resolve({ ok: code === 0, command, stdout, stderr }));
    });
  },
};

export interface FileIO {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

const defaultFileIO: FileIO = {
  readFile: (path) => fsReadFile(path, 'utf8'),
  writeFile: (path, content) => fsWriteFile(path, content, 'utf8'),
};

export interface ApplyFixOptions {
  /** Workspace root the plan applies to (the throwaway clone). */
  root: string;
  runner?: PackageManagerRunner;
  io?: FileIO;
  /** Receives fine-grained activity lines (the edit, the lockfile command + output). */
  onLog?: (message: string) => void;
}

export interface PatchResult {
  plan: FixPlan;
  manifestPath: string;
  manifestBefore: string;
  manifestAfter: string;
  manifestChanged: boolean;
  lockfile: { regenerated: boolean; command: string; error?: string };
}

/** Detect the indentation used by an existing JSON document (defaults to 2 spaces). */
export function detectJsonIndent(source: string): string | number {
  const match = source.match(/\{\s*\n([ \t]+)/);
  if (!match) return 2;
  const indent = match[1]!;
  return indent.includes('\t') ? '\t' : indent.length;
}

/** Set `field[name] = range` in a parsed package.json, returning a new object. */
export function setDependencyRange(
  pkg: Record<string, unknown>,
  field: string,
  name: string,
  range: string,
): Record<string, unknown> {
  const existing = (pkg[field] as Record<string, string> | undefined) ?? {};
  return { ...pkg, [field]: { ...existing, [name]: range } };
}

/**
 * Apply a `FixPlan` to a workspace (§5.11 step 3): edit the manifest range, then
 * regenerate the lockfile with scripts disabled. fs and the package-manager runner
 * are injectable so this is fully unit-testable without touching a real registry.
 */
export async function applyFix(plan: FixPlan, options: ApplyFixOptions): Promise<PatchResult> {
  const io = options.io ?? defaultFileIO;
  const runner = options.runner ?? defaultPackageManagerRunner;
  const log = options.onLog;

  const manifestAbs = resolveWithin(options.root, plan.manifestPath);
  const manifestBefore = await io.readFile(manifestAbs);
  const parsed = JSON.parse(manifestBefore) as Record<string, unknown>;

  const updated = setDependencyRange(parsed, plan.field, plan.packageName, plan.newRange);
  const indent = detectJsonIndent(manifestBefore);
  const trailingNewline = manifestBefore.endsWith('\n') ? '\n' : '';
  const manifestAfter = JSON.stringify(updated, null, indent) + trailingNewline;
  const manifestChanged = manifestAfter !== manifestBefore;

  log?.(
    `editing ${plan.manifestPath}: ${plan.packageName} "${plan.currentRange}" → "${plan.newRange}"`,
  );
  if (manifestChanged) await io.writeFile(manifestAbs, manifestAfter);

  log?.(`regenerating ${plan.lockfilePath}…`);
  const regen = await runner.regenerateLockfile({
    cwd: options.root,
    manager: plan.manager,
    ...(log ? { onLog: log } : {}),
  });
  log?.(
    regen.ok ? 'lockfile regenerated' : `lockfile regeneration failed (${regen.stderr.trim()})`,
  );

  return {
    plan,
    manifestPath: plan.manifestPath,
    manifestBefore,
    manifestAfter,
    manifestChanged,
    lockfile: {
      regenerated: regen.ok,
      command: regen.command,
      ...(regen.ok ? {} : { error: regen.stderr || 'lockfile regeneration failed' }),
    },
  };
}
