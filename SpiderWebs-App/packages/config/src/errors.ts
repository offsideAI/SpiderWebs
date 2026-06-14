/** Base class for configuration failures; the CLI maps these to exit code 2. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** The config file failed schema validation. */
export class ConfigValidationError extends ConfigError {
  override name = 'ConfigValidationError';

  constructor(
    message: string,
    readonly filepath: string | null,
  ) {
    super(filepath ? `Invalid configuration in ${filepath}: ${message}` : message);
  }
}

/**
 * A secret-like key was found in a config file. Tokens come only from env
 * vars (GITHUB_TOKEN, NVD_API_KEY, ANTHROPIC_API_KEY) — never from config
 * files (PRD §10).
 */
export class ConfigSecretError extends ConfigError {
  override name = 'ConfigSecretError';

  constructor(
    readonly keyPath: string,
    readonly filepath: string | null,
  ) {
    super(
      `Refusing to load configuration${filepath ? ` from ${filepath}` : ''}: ` +
        `key "${keyPath}" looks like a credential. SpiderWebs never reads secrets from ` +
        `config files. Set GITHUB_TOKEN, NVD_API_KEY, or ANTHROPIC_API_KEY in the ` +
        `environment instead, and remove the key from the file.`,
    );
  }
}
