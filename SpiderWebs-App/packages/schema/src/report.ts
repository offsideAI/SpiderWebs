import { z } from 'zod';
import { ComponentSchema } from './component.js';
import { CorrelationSchema } from './correlation.js';
import { FindingSchema, type Finding } from './finding.js';
import { SEVERITIES, SeveritySchema, type Severity } from './severity.js';

export const DataSourceNameSchema = z.enum(['osv', 'nvd', 'epss', 'kev', 'github']);
export type DataSourceName = z.infer<typeof DataSourceNameSchema>;

/**
 * Per-source availability. A degraded source marks itself `unavailable` in the
 * report instead of failing the run (PRD §11).
 */
export const DataSourceStatusSchema = z.object({
  name: DataSourceNameSchema,
  status: z.enum(['ok', 'cache', 'unavailable', 'disabled']),
  snapshotAt: z.iso.datetime().optional(),
});
export type DataSourceStatus = z.infer<typeof DataSourceStatusSchema>;

/** Exhaustive severity → count map (every severity key present). */
export const SeverityCountsSchema = z.record(SeveritySchema, z.number().int().nonnegative());
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;

export const ReportSummarySchema = z.object({
  totalFindings: z.number().int().nonnegative(),
  bySeverity: SeverityCountsSchema,
  kevCount: z.number().int().nonnegative(),
  fixAvailableCount: z.number().int().nonnegative(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const AgentReportSchema = z.object({
  enabled: z.boolean(),
  model: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  executiveSummary: z.string().optional(),
});
export type AgentReport = z.infer<typeof AgentReportSchema>;

/** The complete machine report (PRD §5.9). */
export const ReportSchema = z.object({
  schemaVersion: z.literal(1),
  tool: z.object({
    name: z.literal('spiderwebs'),
    version: z.string().min(1),
  }),
  repo: z.object({
    /** The target exactly as the user supplied it. */
    target: z.string().min(1),
    url: z.url().optional(),
    ref: z.string().optional(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    subdir: z.string().optional(),
  }),
  scan: z.object({
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    durationMs: z.number().int().nonnegative(),
  }),
  dataSources: z.array(DataSourceStatusSchema).default([]),
  summary: ReportSummarySchema,
  components: z.array(ComponentSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  correlations: z.array(CorrelationSchema).default([]),
  agent: AgentReportSchema.prefault({ enabled: false }),
});
export type Report = z.infer<typeof ReportSchema>;

export function emptySeverityCounts(): SeverityCounts {
  return Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as SeverityCounts;
}

/** Derive the report summary from a finding list (pure, deterministic). */
export function summarizeFindings(findings: readonly Finding[]): ReportSummary {
  const bySeverity = emptySeverityCounts();
  let kevCount = 0;
  let fixAvailableCount = 0;
  for (const finding of findings) {
    bySeverity[finding.severity as Severity] += 1;
    if (finding.type === 'dependency') {
      if (finding.advisory.kev?.listed) kevCount += 1;
      if (finding.fixedVersions.length > 0) fixAvailableCount += 1;
    }
  }
  return { totalFindings: findings.length, bySeverity, kevCount, fixAvailableCount };
}
