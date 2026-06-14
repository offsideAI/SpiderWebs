import { pino, type DestinationStream, type Logger } from 'pino';
import pretty from 'pino-pretty';

export type { Logger } from 'pino';

export interface LoggerFlags {
  quiet?: boolean;
  verbose?: boolean;
}

export function resolveLogLevel(flags: LoggerFlags = {}): 'error' | 'debug' | 'info' {
  if (flags.quiet) return 'error';
  if (flags.verbose) return 'debug';
  return 'info';
}

export interface CreateLoggerOptions extends LoggerFlags {
  /** Pretty-print for humans; default true on a TTY stderr. */
  pretty?: boolean;
  /** Where logs go. Defaults to stderr — stdout is reserved for report output. */
  destination?: DestinationStream | NodeJS.WritableStream;
}

/**
 * Defense-in-depth: any token-shaped property that reaches the logger is
 * censored. Tokens should never be passed to log calls in the first place.
 */
const REDACT_PATHS = [
  'token',
  'apiKey',
  'authorization',
  'password',
  'secret',
  '*.token',
  '*.apiKey',
  '*.authorization',
  '*.password',
  '*.secret',
  'headers.authorization',
];

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const destination = options.destination ?? process.stderr;
  const usePretty =
    options.pretty ?? (destination === process.stderr && Boolean(process.stderr.isTTY));

  const stream: DestinationStream = usePretty
    ? pretty({ destination: destination as NodeJS.WritableStream, colorize: true })
    : (destination as DestinationStream);

  return pino(
    {
      name: 'spiderwebs',
      level: resolveLogLevel(options),
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base: undefined,
    },
    stream,
  );
}
