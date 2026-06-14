import type { Writable } from 'node:stream';
import { ExitCode } from '@spiderwebs/core';

/**
 * Everything a command needs from its environment, injected so tests can run
 * the whole CLI in-process with memory streams and a synthetic env.
 */
export interface CliContext {
  stdout: Writable;
  stderr: Writable;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Set by command actions; the entrypoint copies it to process.exitCode. */
  exitCode: ExitCode;
}

export function createProcessContext(): CliContext {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
    exitCode: ExitCode.Clean,
  };
}

/** An error with a specific exit code (defaults to ToolError). */
export class CliError extends Error {
  override name = 'CliError';

  constructor(
    message: string,
    readonly exitCode: ExitCode = ExitCode.ToolError,
  ) {
    super(message);
  }
}

export class NotImplementedError extends CliError {
  override name = 'NotImplementedError';

  constructor(command: string, milestone: string) {
    super(`"spiderwebs ${command}" is not implemented yet — it arrives in ${milestone}.`);
  }
}
