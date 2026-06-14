import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FailOn } from '@spiderwebs/schema';
import { FailOnSchema } from '@spiderwebs/schema';
import { cosmiconfig } from 'cosmiconfig';
import { ConfigValidationError } from './errors.js';
import { ConfigSchema, type ReportFormat, type SpiderwebsConfig } from './schema.js';
import { assertNoSecretLikeKeys } from './secrets.js';

const MODULE_NAME = 'spiderwebs';

// `.ts` config files (PRD §10 example) need a TypeScript loader; deferred to a
// later milestone — documented in the README.
const SEARCH_PLACES = [
  'package.json',
  '.spiderwebsrc',
  '.spiderwebsrc.json',
  '.spiderwebsrc.yaml',
  '.spiderwebsrc.yml',
  '.spiderwebsrc.js',
  '.spiderwebsrc.cjs',
  '.spiderwebsrc.mjs',
  'spiderwebs.config.js',
  'spiderwebs.config.cjs',
  'spiderwebs.config.mjs',
];

/** Flag values the CLI layers on top of file/env config (highest precedence). */
export interface CliOverrides {
  failOn?: FailOn;
  offline?: boolean;
  cacheDir?: string;
  /** `--no-agent` */
  agent?: boolean;
  formats?: ReportFormat[];
  outDir?: string;
}

export interface ResolveConfigOptions {
  /** Directory to search for project config (default: process.cwd()). */
  cwd?: string;
  /** Explicit config file path (`--config`); skips searching. */
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cli?: CliOverrides;
}

export interface ResolvedConfig {
  config: SpiderwebsConfig;
  /** Path of the config file that was loaded, or null when running on defaults. */
  filepath: string | null;
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge plain objects; arrays and scalars are replaced, not concatenated. */
function deepMerge(base: PlainObject, overlay: PlainObject): PlainObject {
  const result: PlainObject = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const existing = result[key];
    result[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return result;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === '1' || value.toLowerCase() === 'true';
}

/** Non-secret settings overridable via SPIDERWEBS_* env vars (PRD §10 precedence). */
function envOverlay(env: NodeJS.ProcessEnv): PlainObject {
  const overlay: PlainObject = {};
  if (env.SPIDERWEBS_FAIL_ON !== undefined) {
    const parsed = FailOnSchema.safeParse(env.SPIDERWEBS_FAIL_ON);
    if (!parsed.success) {
      throw new ConfigValidationError(
        `SPIDERWEBS_FAIL_ON must be one of ${FailOnSchema.options.join(', ')}; got "${env.SPIDERWEBS_FAIL_ON}"`,
        null,
      );
    }
    overlay.failOn = parsed.data;
  }
  const offline = parseBooleanEnv(env.SPIDERWEBS_OFFLINE);
  if (offline !== undefined) overlay.offline = offline;
  if (env.SPIDERWEBS_CACHE_DIR) overlay.cacheDir = env.SPIDERWEBS_CACHE_DIR;
  return overlay;
}

function cliOverlay(cli: CliOverrides): PlainObject {
  const overlay: PlainObject = {};
  if (cli.failOn !== undefined) overlay.failOn = cli.failOn;
  if (cli.offline !== undefined) overlay.offline = cli.offline;
  if (cli.cacheDir !== undefined) overlay.cacheDir = cli.cacheDir;
  if (cli.agent !== undefined) overlay.agent = { enabled: cli.agent };
  const report: PlainObject = {};
  if (cli.formats !== undefined) report.formats = cli.formats;
  if (cli.outDir !== undefined) report.outDir = cli.outDir;
  if (Object.keys(report).length > 0) overlay.report = report;
  return overlay;
}

function expandTilde(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve effective configuration with PRD §10 precedence:
 * CLI flags > env vars > project config file > defaults.
 */
export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<ResolvedConfig> {
  const { cwd = process.cwd(), configPath, env = process.env, cli = {} } = options;

  const explorer = cosmiconfig(MODULE_NAME, {
    searchPlaces: SEARCH_PLACES,
    searchStrategy: 'project',
  });

  const result = configPath ? await explorer.load(configPath) : await explorer.search(cwd);

  let fileConfig: PlainObject = {};
  const filepath = result?.filepath ?? null;
  if (result && !result.isEmpty) {
    if (!isPlainObject(result.config)) {
      throw new ConfigValidationError('configuration must be an object', filepath);
    }
    assertNoSecretLikeKeys(result.config, filepath);
    fileConfig = result.config;
  }

  const merged = deepMerge(deepMerge(fileConfig, envOverlay(env)), cliOverlay(cli));

  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigValidationError(issues, filepath);
  }

  const config = parsed.data;
  config.cacheDir = expandTilde(config.cacheDir);
  return { config, filepath };
}
