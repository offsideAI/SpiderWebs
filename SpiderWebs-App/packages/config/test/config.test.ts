import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ConfigSecretError,
  ConfigValidationError,
  assertNoSecretLikeKeys,
  defaultConfig,
  describeSecretAvailability,
  getSecrets,
  resolveConfig,
} from '../src/index.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

// Isolated env: tests never read the developer's real environment.
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe('defaults', () => {
  it('produces the documented defaults with no config file', async () => {
    const { config, filepath } = await resolveConfig({ cwd: fixture('empty'), env: EMPTY_ENV });
    expect(filepath).toBeNull();
    expect(config.failOn).toBe('none');
    expect(config.offline).toBe(false);
    expect(config.sources).toEqual({ osv: true, nvd: true, epss: true, kev: true, github: true });
    expect(config.agent).toEqual({
      enabled: true,
      provider: 'anthropic',
      budgetUsd: 0.5,
      sourceToLlm: true,
    });
    expect(config.report).toEqual({ formats: ['markdown'], outDir: './spiderwebs-out' });
    expect(config.cacheDir).not.toContain('~'); // tilde expanded
    expect(config.cacheDir.endsWith('/.spiderwebs/cache')).toBe(true);
  });

  it('defaultConfig() parses cleanly from an empty object', () => {
    expect(defaultConfig().failOn).toBe('none');
  });
});

describe('file loading', () => {
  it('loads .spiderwebsrc.json', async () => {
    const { config, filepath } = await resolveConfig({ cwd: fixture('json-rc'), env: EMPTY_ENV });
    expect(filepath).toContain('.spiderwebsrc.json');
    expect(config.failOn).toBe('medium');
    expect(config.report.formats).toEqual(['json', 'sarif']);
    expect(config.ignore).toEqual(['**/test/fixtures/**']);
    // untouched keys keep defaults
    expect(config.report.outDir).toBe('./spiderwebs-out');
  });

  it('loads .spiderwebsrc.yaml', async () => {
    const { config } = await resolveConfig({ cwd: fixture('yaml-rc'), env: EMPTY_ENV });
    expect(config.failOn).toBe('critical');
    expect(config.licensePolicy).toEqual({ deny: ['AGPL-3.0'], warn: ['GPL-3.0'] });
  });

  it('loads the "spiderwebs" key from package.json', async () => {
    const { config } = await resolveConfig({ cwd: fixture('package-json'), env: EMPTY_ENV });
    expect(config.offline).toBe(true);
    expect(config.agent.enabled).toBe(false);
    expect(config.agent.provider).toBe('anthropic'); // sibling default preserved
  });

  it('loads an explicit --config path', async () => {
    const { config, filepath } = await resolveConfig({
      cwd: fixture('empty'),
      configPath: `${fixture('json-rc')}.spiderwebsrc.json`,
      env: EMPTY_ENV,
    });
    expect(filepath).toContain('json-rc');
    expect(config.failOn).toBe('medium');
  });

  it('rejects invalid enum values with the file path in the message', async () => {
    await expect(
      resolveConfig({ cwd: fixture('invalid-value'), env: EMPTY_ENV }),
    ).rejects.toThrowError(ConfigValidationError);
    await expect(
      resolveConfig({ cwd: fixture('invalid-value'), env: EMPTY_ENV }),
    ).rejects.toThrowError(/invalid-value.*failOn/s);
  });

  it('rejects unknown keys (strict config)', async () => {
    await expect(resolveConfig({ cwd: fixture('unknown-key'), env: EMPTY_ENV })).rejects.toThrow(
      /failOnn/,
    );
  });
});

describe('secrets stay out of config files (PRD §10)', () => {
  it('refuses to load a config containing a token-like key', async () => {
    const promise = resolveConfig({ cwd: fixture('with-secret'), env: EMPTY_ENV });
    await expect(promise).rejects.toThrowError(ConfigSecretError);
    await expect(promise).rejects.toThrow(/github\.token/);
    await expect(promise).rejects.toThrow(/GITHUB_TOKEN/); // points at the env var instead
  });

  it('never echoes the secret value in the error message', async () => {
    const error = await resolveConfig({ cwd: fixture('with-secret'), env: EMPTY_ENV }).then(
      () => null,
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(ConfigSecretError);
    expect(error?.message).not.toContain('ghp_');
  });

  it.each([
    ['githubToken'],
    ['apiKey'],
    ['api_key'],
    ['ANTHROPIC_SECRET'],
    ['password'],
    ['credentials'],
  ])('flags secret-like key %s at any depth', (key) => {
    expect(() => assertNoSecretLikeKeys({ nested: { deeper: { [key]: 'x' } } }, null)).toThrow(
      ConfigSecretError,
    );
  });

  it('allows legitimate keys', () => {
    expect(() => assertNoSecretLikeKeys(defaultConfig(), null)).not.toThrow();
  });
});

describe('precedence: cli > env > file > defaults (PRD §10)', () => {
  it('env overrides file', async () => {
    const { config } = await resolveConfig({
      cwd: fixture('json-rc'), // file says medium
      env: { SPIDERWEBS_FAIL_ON: 'critical', SPIDERWEBS_OFFLINE: 'true' },
    });
    expect(config.failOn).toBe('critical');
    expect(config.offline).toBe(true);
  });

  it('cli overrides env and file', async () => {
    const { config } = await resolveConfig({
      cwd: fixture('json-rc'),
      env: { SPIDERWEBS_FAIL_ON: 'critical' },
      cli: { failOn: 'low', agent: false, outDir: './custom-out' },
    });
    expect(config.failOn).toBe('low');
    expect(config.agent.enabled).toBe(false);
    expect(config.report.outDir).toBe('./custom-out');
    expect(config.report.formats).toEqual(['json', 'sarif']); // file value survives partial override
  });

  it('rejects a malformed SPIDERWEBS_FAIL_ON instead of silently ignoring it', async () => {
    await expect(
      resolveConfig({ cwd: fixture('empty'), env: { SPIDERWEBS_FAIL_ON: 'sometimes' } }),
    ).rejects.toThrow(/SPIDERWEBS_FAIL_ON/);
  });

  it('SPIDERWEBS_CACHE_DIR overrides the default', async () => {
    const { config } = await resolveConfig({
      cwd: fixture('empty'),
      env: { SPIDERWEBS_CACHE_DIR: '/tmp/sw-cache' },
    });
    expect(config.cacheDir).toBe('/tmp/sw-cache');
  });
});

describe('secrets from env only', () => {
  it('reads the three documented env vars', () => {
    expect(getSecrets({ GITHUB_TOKEN: 'g', NVD_API_KEY: 'n', ANTHROPIC_API_KEY: 'a' })).toEqual({
      githubToken: 'g',
      nvdApiKey: 'n',
      anthropicApiKey: 'a',
    });
    expect(getSecrets({})).toEqual({});
  });

  it('describes availability without exposing values', () => {
    const described = describeSecretAvailability({ GITHUB_TOKEN: 'ghp_secret123' });
    expect(described).toEqual({
      GITHUB_TOKEN: 'set',
      NVD_API_KEY: 'unset',
      ANTHROPIC_API_KEY: 'unset',
    });
    expect(JSON.stringify(described)).not.toContain('ghp_');
  });

  it('resolved config never contains secret material', async () => {
    const { config } = await resolveConfig({
      cwd: fixture('empty'),
      env: { GITHUB_TOKEN: 'ghp_secret123', ANTHROPIC_API_KEY: 'sk-ant-xyz' },
    });
    expect(JSON.stringify(config)).not.toMatch(/ghp_|sk-ant/);
  });
});
