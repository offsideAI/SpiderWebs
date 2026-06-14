import { FailOnSchema } from '@spiderwebs/schema';
import { z } from 'zod';

export const ReportFormatSchema = z.enum(['markdown', 'json', 'sarif', 'html']);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

/**
 * Project configuration (PRD §10). Strict objects: unknown keys are rejected
 * with a helpful error rather than silently ignored.
 */
export const ConfigSchema = z.strictObject({
  sources: z
    .strictObject({
      osv: z.boolean().default(true),
      nvd: z.boolean().default(true),
      epss: z.boolean().default(true),
      kev: z.boolean().default(true),
      github: z.boolean().default(true),
    })
    .prefault({}),
  failOn: FailOnSchema.default('none'),
  offline: z.boolean().default(false),
  cacheDir: z.string().min(1).default('~/.spiderwebs/cache'),
  agent: z
    .strictObject({
      enabled: z.boolean().default(true),
      provider: z.enum(['anthropic']).default('anthropic'),
      budgetUsd: z.number().positive().max(100).default(0.5),
      /** When false, only findings/issue metadata go to the LLM — no source (PRD §12). */
      sourceToLlm: z.boolean().default(true),
    })
    .prefault({}),
  /** Glob patterns excluded from scanning, gitignore syntax. */
  ignore: z.array(z.string()).default([]),
  licensePolicy: z
    .strictObject({
      deny: z.array(z.string()).default([]),
      warn: z.array(z.string()).default([]),
    })
    .prefault({}),
  report: z
    .strictObject({
      formats: z.array(ReportFormatSchema).min(1).default(['markdown']),
      outDir: z.string().min(1).default('./spiderwebs-out'),
    })
    .prefault({}),
});
export type SpiderwebsConfig = z.infer<typeof ConfigSchema>;

export function defaultConfig(): SpiderwebsConfig {
  return ConfigSchema.parse({});
}
