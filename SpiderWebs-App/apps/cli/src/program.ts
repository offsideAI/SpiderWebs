import { createRequire } from 'node:module';
import { resolveConfig, describeSecretAvailability, type CliOverrides } from '@spiderwebs/config';
import { ExitCode } from '@spiderwebs/core';
import { FAIL_ON_LEVELS, type FailOn } from '@spiderwebs/schema';
import { Command, InvalidArgumentError, Option } from 'commander';
import { CliError, NotImplementedError, type CliContext } from './context.js';
import { defaultFixDeps, runFixCommand, type FixCommandOptions } from './fixCommand.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };

function parseFailOn(value: string): FailOn {
  if (!(FAIL_ON_LEVELS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`must be one of: ${FAIL_ON_LEVELS.join(', ')}.`);
  }
  return value as FailOn;
}

/**
 * Wrap a command action: errors become stderr messages + exit code 2 (or the
 * error's own code), never an unhandled throw or a leaked stack by default.
 */
function runAction<Args extends unknown[]>(
  ctx: CliContext,
  action: (...args: Args) => void | Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.stderr.write(`spiderwebs: error: ${message}\n`);
      ctx.exitCode = error instanceof CliError ? error.exitCode : ExitCode.ToolError;
    }
  };
}

export function buildProgram(ctx: CliContext): Command {
  const program = new Command('spiderwebs');

  program
    .description(
      'Defensive security auditor for remote Git repositories: SCA, vulnerability\n' +
        'database cross-checks, GitHub issue correlation, and patch-aware reports.',
    )
    .version(VERSION, '-V, --version', 'print the version number')
    .option('--verbose', 'verbose (debug) logging')
    .option('--quiet', 'errors only')
    .option('--no-color', 'disable colored output')
    .option('--ci', 'non-interactive mode: no TUI, deterministic output')
    .option('--config <path>', 'path to a config file (skips searching)')
    .configureOutput({
      writeOut: (str) => void ctx.stdout.write(str),
      writeErr: (str) => void ctx.stderr.write(str),
    })
    .exitOverride();

  program
    .command('scan')
    .description('clone and scan a repository for known vulnerabilities')
    .argument('<target>', 'repo URL, org/repo shorthand, or local path')
    .option('--ref <ref>', 'branch, tag, or commit SHA to scan')
    .option('--subdir <path>', 'scope the scan to a subdirectory')
    .option('--manifest <file>', 'scope the scan to a single manifest/lockfile')
    .option('--full', 'full clone with history (enables git-history secret scan)')
    .option('--keep', 'keep the temp workspace after the run')
    .option('--offline', 'no network: use the on-disk cache only')
    .option('--no-agent', 'skip the LLM reasoning layer; deterministic report only')
    .addOption(
      new Option('--fail-on <level>', 'exit 1 when findings at/above this severity exist')
        .choices(FAIL_ON_LEVELS)
        .argParser(parseFailOn),
    )
    .option('--json', 'write the JSON report to stdout')
    .option('--sbom <file>', 'also emit a CycloneDX SBOM to <file>')
    .option('--out <dir>', 'report output directory')
    .action(
      runAction(ctx, () => {
        throw new NotImplementedError('scan', 'Milestone 1 (deterministic SCA core)');
      }),
    );

  program
    .command('fix')
    .description('scan, then patch direct-dependency vulnerabilities and open pull requests')
    .argument('<target>', 'repo URL, org/repo shorthand, or local path')
    .option('--finding <id>', 'fix only the finding with this id')
    .option('--all-direct', 'fix every fixable direct dependency (default)')
    .option('--dry-run', 'do everything except push/PR; show the diff and intended PR')
    .option('-y, --yes', 'skip the confirmation prompt (non-interactive consent)')
    .option('--keep', 'keep the .spiderwebs-workspace clone after the run')
    .option('--offline', 'no network (cannot open PRs; useful with --dry-run on a local clone)')
    .action(
      runAction(ctx, async (target: string, options: Omit<FixCommandOptions, 'target'>) => {
        ctx.exitCode = await runFixCommand(ctx, { target, ...options }, defaultFixDeps(ctx));
      }),
    );

  program
    .command('report')
    .description('re-render a previous scan result in another format')
    .argument('[input]', 'path to a JSON report from a previous scan')
    .option('--format <format...>', 'one or more of: markdown, json, sarif, html')
    .option('--out <dir>', 'report output directory')
    .action(
      runAction(ctx, () => {
        throw new NotImplementedError('report', 'Milestone 2 (report formats)');
      }),
    );

  program
    .command('sbom')
    .description('emit a CycloneDX SBOM for a repository')
    .argument('<target>', 'repo URL, org/repo shorthand, or local path')
    .option('--out <file>', 'output file (default: stdout)')
    .action(
      runAction(ctx, () => {
        throw new NotImplementedError('sbom', 'Milestone 2 (SBOM emit)');
      }),
    );

  const db = program.command('db').description('manage the local vulnerability data cache');
  db.command('update')
    .description('refresh KEV/EPSS/OSV snapshots in ~/.spiderwebs/cache')
    .action(
      runAction(ctx, () => {
        throw new NotImplementedError('db update', 'Milestone 2 (on-disk cache)');
      }),
    );

  program
    .command('config')
    .description('print the resolved configuration and secret availability')
    .option('--json', 'output as JSON')
    .action(
      runAction(ctx, async (options: { json?: boolean }) => {
        const globals = program.opts<{ config?: string }>();
        const { config, filepath } = await resolveConfig({
          cwd: ctx.cwd,
          env: ctx.env,
          ...(globals.config !== undefined ? { configPath: globals.config } : {}),
        });
        // Presence only — secret values are never printed or logged.
        const secrets = describeSecretAvailability(ctx.env);
        if (options.json) {
          ctx.stdout.write(
            `${JSON.stringify({ configFile: filepath, config, secrets }, null, 2)}\n`,
          );
        } else {
          ctx.stdout.write(`config file: ${filepath ?? '(none — defaults)'}\n`);
          ctx.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
          ctx.stdout.write('secrets (from environment only):\n');
          for (const [name, status] of Object.entries(secrets)) {
            ctx.stdout.write(`  ${name}: ${status}\n`);
          }
        }
        ctx.exitCode = ExitCode.Clean;
      }),
    );

  program
    .command('version')
    .description('print the version number')
    .action(
      runAction(ctx, () => {
        ctx.stdout.write(`spiderwebs ${VERSION}\n`);
        ctx.exitCode = ExitCode.Clean;
      }),
    );

  return program;
}

/** CLI flag → config override mapping, shared by scan/report once implemented. */
export function overridesFromFlags(flags: {
  failOn?: FailOn;
  offline?: boolean;
  agent?: boolean;
  out?: string;
}): CliOverrides {
  const overrides: CliOverrides = {};
  if (flags.failOn !== undefined) overrides.failOn = flags.failOn;
  if (flags.offline !== undefined) overrides.offline = flags.offline;
  if (flags.agent !== undefined) overrides.agent = flags.agent;
  if (flags.out !== undefined) overrides.outDir = flags.out;
  return overrides;
}

/**
 * Parse argv and return the exit code (PRD §5.10): 0 clean, 1 findings at or
 * above threshold, 2 tool/usage error. Commander's help/version paths exit 0.
 */
export async function runCli(ctx: CliContext, argv: readonly string[]): Promise<ExitCode> {
  const program = buildProgram(ctx);
  try {
    await program.parseAsync(argv as string[], { from: 'user' });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === 'commander.helpDisplayed' ||
      code === 'commander.version' ||
      code === 'commander.help'
    ) {
      return ExitCode.Clean;
    }
    // Usage errors (unknown command/option, missing argument) are tool errors.
    return ExitCode.ToolError;
  }
  return ctx.exitCode;
}
