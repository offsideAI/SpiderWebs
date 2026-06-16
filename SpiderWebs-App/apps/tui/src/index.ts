import { EventBus } from '@spiderwebs/core/bus';
import { runScan, type RunScanOptions } from '@spiderwebs/scanner';
import { render } from 'ink';
import { createElement } from 'react';
import { App } from './components/App.js';
import { runHeadlessScan } from './headless.js';

interface CliArgs {
  target?: string;
  offline: boolean;
  keep: boolean;
  ref?: string;
  subdir?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { offline: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--offline') args.offline = true;
    else if (token === '--keep') args.keep = true;
    else if (token === '--ref') args.ref = argv[++i];
    else if (token === '--subdir') args.subdir = argv[++i];
    else if (token && !token.startsWith('-') && !args.target) args.target = token;
  }
  return args;
}

function scanOptions(args: CliArgs): RunScanOptions {
  return {
    target: args.target!,
    cwd: process.cwd(),
    offline: args.offline,
    keep: args.keep,
    ...(args.ref ? { ref: args.ref } : {}),
    ...(args.subdir ? { subdir: args.subdir } : {}),
  };
}

/**
 * Drive the Ink dashboard. With a target it runs a real scan immediately;
 * without a target it prompts the user to type one.
 * Falls back to plain output when there is no interactive TTY.
 */
async function main(): Promise<void> {
  // Exit cleanly when a downstream reader closes the pipe (e.g. `| head`).
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });

  const args = parseArgs(process.argv.slice(2));
  const interactive = Boolean(process.stdout.isTTY) && !process.env.SPIDERWEBS_TUI_HEADLESS;

  if (!interactive) {
    if (!args.target) {
      process.stderr.write('Error: target repository or directory is required in non-interactive mode.\n');
      process.exitCode = 2;
      return;
    }
    process.exitCode = await runHeadlessScan(process.stdout, scanOptions(args));
    return;
  }

  const bus = new EventBus();
  const app = render(
    createElement(App, {
      bus,
      initialTarget: args.target,
      onStartScan: (targetUrl) => {
        const opts = { ...scanOptions(args), target: targetUrl };
        runScan(opts, bus).catch((error: unknown) => {
          const at = new Date().toISOString();
          bus.emit({
            type: 'error',
            runId: 'scan',
            at,
            message: error instanceof Error ? error.message : String(error),
            fatal: true,
          });
          bus.emit({ type: 'run:done', runId: 'scan', at, exitCode: 2 });
        });
      },
    }),
  );

  if (args.target) {
    // Real scan: runScan emits its own events (including graceful errors). Guard
    // against an unexpected throw so the UI still surfaces it instead of hanging.
    runScan(scanOptions(args), bus).catch((error: unknown) => {
      const at = new Date().toISOString();
      bus.emit({
        type: 'error',
        runId: 'scan',
        at,
        message: error instanceof Error ? error.message : String(error),
        fatal: true,
      });
      bus.emit({ type: 'run:done', runId: 'scan', at, exitCode: 2 });
    });
  }

  await app.waitUntilExit();
}

void main();
