import type { FailOn, Severity } from '@spiderwebs/schema';
import { SEVERITY_RANK } from '@spiderwebs/schema';

/** CLI exit codes (PRD §5.10). */
export const ExitCode = {
  /** No findings at/above the `--fail-on` threshold (or threshold is `none`). */
  Clean: 0,
  /** At least one finding at/above the threshold. */
  FindingsAtThreshold: 1,
  /** Tool error: bad usage, network/config failure, unhandled exception. */
  ToolError: 2,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

const FAIL_ON_RANK: Record<Exclude<FailOn, 'none'>, number> = {
  low: SEVERITY_RANK.low,
  medium: SEVERITY_RANK.medium,
  high: SEVERITY_RANK.high,
  critical: SEVERITY_RANK.critical,
};

/** Does a finding of `severity` trip the `failOn` gate? `unknown` ranks with `low`. */
export function severityMeetsThreshold(severity: Severity, failOn: FailOn): boolean {
  if (failOn === 'none') return false;
  return SEVERITY_RANK[severity] >= FAIL_ON_RANK[failOn];
}

/** Map a finding set + threshold to the CI exit code (PRD §5.10). */
export function determineExitCode(
  findings: ReadonlyArray<{ severity: Severity }>,
  failOn: FailOn,
): ExitCode {
  return findings.some((f) => severityMeetsThreshold(f.severity, failOn))
    ? ExitCode.FindingsAtThreshold
    : ExitCode.Clean;
}
