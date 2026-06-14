import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ExitCode } from '@spiderwebs/core';
import { describe, expect, it } from 'vitest';
import { type CliContext } from '../src/context.js';
import { overridesFromFlags, runCli } from '../src/program.js';

class MemorySink extends Writable {
  data = '';

  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.data += chunk.toString();
    cb();
  }
}

const emptyDir = fileURLToPath(
  new URL('../../../packages/config/test/fixtures/empty/', import.meta.url),
);
const secretDir = fileURLToPath(
  new URL('../../../packages/config/test/fixtures/with-secret/', import.meta.url),
);

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<RunResult> {
  const stdout = new MemorySink();
  const stderr = new MemorySink();
  const ctx: CliContext = {
    stdout,
    stderr,
    env: options.env ?? {},
    cwd: options.cwd ?? emptyDir,
    exitCode: ExitCode.Clean,
  };
  const exitCode = await runCli(ctx, args);
  return { exitCode, stdout: stdout.data, stderr: stderr.data };
}

describe('version', () => {
  it('the version subcommand prints the version and exits 0', async () => {
    const result = await run(['version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^spiderwebs \d+\.\d+\.\d+\n$/);
  });

  it('-V prints the version and exits 0', async () => {
    const result = await run(['-V']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe('help and usage errors', () => {
  it('--help exits 0 and lists all subcommands', async () => {
    const result = await run(['--help']);
    expect(result.exitCode).toBe(0);
    for (const command of ['scan', 'report', 'sbom', 'db', 'config', 'version']) {
      expect(result.stdout).toContain(command);
    }
  });

  it('an unknown command is a tool error (exit 2)', async () => {
    const result = await run(['exploit']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown command');
  });

  it('a missing required argument is a tool error (exit 2)', async () => {
    const result = await run(['scan']);
    expect(result.exitCode).toBe(2);
  });

  it('an invalid --fail-on value is a tool error (exit 2)', async () => {
    const result = await run(['scan', 'org/repo', '--fail-on', 'extreme']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--fail-on');
  });
});

describe('milestone stubs', () => {
  it.each([[['scan', 'org/repo']], [['report']], [['sbom', 'org/repo']], [['db', 'update']]])(
    '%j exits 2 with a clear not-implemented message',
    async (args) => {
      const result = await run(args);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('not implemented yet');
      expect(result.stderr).toContain('Milestone');
    },
  );
});

describe('config command', () => {
  it('prints resolved defaults and secret availability without leaking values', async () => {
    const result = await run(['config', '--json'], {
      env: { GITHUB_TOKEN: 'ghp_secret123' },
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      configFile: string | null;
      config: { failOn: string };
      secrets: Record<string, string>;
    };
    expect(parsed.configFile).toBeNull();
    expect(parsed.config.failOn).toBe('none');
    expect(parsed.secrets).toEqual({
      GITHUB_TOKEN: 'set',
      NVD_API_KEY: 'unset',
      ANTHROPIC_API_KEY: 'unset',
    });
    expect(result.stdout).not.toContain('ghp_secret123');
  });

  it('honors SPIDERWEBS_* env overrides', async () => {
    const result = await run(['config', '--json'], { env: { SPIDERWEBS_FAIL_ON: 'high' } });
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as { config: { failOn: string } }).config.failOn).toBe(
      'high',
    );
  });

  it('a config file containing a token is rejected with exit 2 and guidance', async () => {
    const result = await run(['config'], { cwd: secretDir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('GITHUB_TOKEN');
    expect(result.stderr).not.toContain('ghp_thisShouldNeverBeAccepted');
  });

  it('human-readable output mode works', async () => {
    const result = await run(['config']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('config file: (none — defaults)');
    expect(result.stdout).toContain('secrets (from environment only):');
  });
});

describe('overridesFromFlags', () => {
  it('maps only the flags that were provided', () => {
    expect(overridesFromFlags({})).toEqual({});
    expect(overridesFromFlags({ failOn: 'high', agent: false, out: './x' })).toEqual({
      failOn: 'high',
      agent: false,
      outDir: './x',
    });
  });
});
