import { ConfigSecretError } from './errors.js';

/** The only places secrets may come from (PRD §10). */
export const SECRET_ENV_VARS = ['GITHUB_TOKEN', 'NVD_API_KEY', 'ANTHROPIC_API_KEY'] as const;
export type SecretEnvVar = (typeof SECRET_ENV_VARS)[number];

export interface Secrets {
  githubToken?: string;
  nvdApiKey?: string;
  anthropicApiKey?: string;
}

/** Read secrets from the environment. Values must never be logged or echoed. */
export function getSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const secrets: Secrets = {};
  if (env.GITHUB_TOKEN) secrets.githubToken = env.GITHUB_TOKEN;
  if (env.NVD_API_KEY) secrets.nvdApiKey = env.NVD_API_KEY;
  if (env.ANTHROPIC_API_KEY) secrets.anthropicApiKey = env.ANTHROPIC_API_KEY;
  return secrets;
}

/** Presence-only view, safe to print (used by `spiderwebs config`). */
export function describeSecretAvailability(
  env: NodeJS.ProcessEnv = process.env,
): Record<SecretEnvVar, 'set' | 'unset'> {
  return Object.fromEntries(
    SECRET_ENV_VARS.map((name) => [name, env[name] ? 'set' : 'unset']),
  ) as Record<SecretEnvVar, 'set' | 'unset'>;
}

/** Key names that indicate someone put a credential in a config file. */
const SECRET_LIKE_KEY = /(token|secret|passw(or)?d|credentials?|api[-_]?key|apikey)$/i;

/**
 * Reject config files containing secret-like keys (PRD §10: "Never read
 * tokens from config files"). Walks the raw (pre-validation) object so the
 * error names the exact offending key path.
 */
export function assertNoSecretLikeKeys(value: unknown, filepath: string | null, path = ''): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecretLikeKeys(item, filepath, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (SECRET_LIKE_KEY.test(key)) {
      throw new ConfigSecretError(keyPath, filepath);
    }
    assertNoSecretLikeKeys(child, filepath, keyPath);
  }
}
