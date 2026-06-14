import { z } from 'zod';

/** Severity levels ordered from most to least severe. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'unknown'] as const;

export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/** `--fail-on` threshold levels (PRD §5.10). */
export const FAIL_ON_LEVELS = ['none', 'low', 'medium', 'high', 'critical'] as const;

export const FailOnSchema = z.enum(FAIL_ON_LEVELS);
export type FailOn = z.infer<typeof FailOnSchema>;

/**
 * Numeric rank used for threshold comparisons and stable sorting.
 * `unknown` ranks with `low`: a vulnerability whose severity could not be
 * determined still fails a `--fail-on low` gate rather than slipping through.
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 1,
  info: 0,
};
