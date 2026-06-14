import { z } from 'zod';
import { AdvisorySchema } from './advisory.js';
import { ComponentSchema } from './component.js';
import { SeveritySchema } from './severity.js';

export const FINDING_ID_PATTERN = /^sw-[0-9a-f]{16}$/;

export const SourceLocationSchema = z.object({
  /** Repo-relative path, always forward-slash separated. */
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

const findingBase = {
  /** Stable content-derived id (see `stableId`) so reports diff cleanly across runs. */
  id: z.string().regex(FINDING_ID_PATTERN),
  severity: SeveritySchema,
  title: z.string().min(1),
  /** Composite SpiderWebs Risk Score, 0–100 (PRD §5.7); attached during enrichment. */
  riskScore: z.number().min(0).max(100).optional(),
};

/** A known-vulnerable dependency surfaced by SCA (PRD §5.2). */
export const DependencyFindingSchema = z.object({
  ...findingBase,
  type: z.literal('dependency'),
  component: ComponentSchema,
  advisory: AdvisorySchema,
  /** First fixed version(s) applicable to this component; empty when unfixed. */
  fixedVersions: z.array(z.string()).default([]),
  /** Shortest dependency path that introduced the vulnerable component. */
  dependencyPath: z.array(z.string().min(1)).min(1),
});
export type DependencyFinding = z.infer<typeof DependencyFindingSchema>;

/** A detected secret; the matched value is always redacted (PRD §5.3). */
export const SecretFindingSchema = z.object({
  ...findingBase,
  type: z.literal('secret'),
  rule: z.string().min(1),
  location: SourceLocationSchema,
  /** Redacted preview only (rule + last 4 chars). Never the raw secret. */
  redactedPreview: z.string(),
});
export type SecretFinding = z.infer<typeof SecretFindingSchema>;

/** A lightweight pattern-based code signal; explicitly lower-confidence (PRD §5.4). */
export const CodePatternFindingSchema = z.object({
  ...findingBase,
  type: z.literal('code-pattern'),
  rule: z.string().min(1),
  message: z.string().min(1),
  location: SourceLocationSchema,
  confidence: z.enum(['low', 'medium']).default('low'),
});
export type CodePatternFinding = z.infer<typeof CodePatternFindingSchema>;

/** A license policy violation (PRD §5.5). */
export const LicenseFindingSchema = z.object({
  ...findingBase,
  type: z.literal('license'),
  /** purl of the offending component. */
  componentPurl: z.string().startsWith('pkg:'),
  license: z.string().min(1),
  policyAction: z.enum(['deny', 'warn']),
});
export type LicenseFinding = z.infer<typeof LicenseFindingSchema>;

export const FindingSchema = z.discriminatedUnion('type', [
  DependencyFindingSchema,
  SecretFindingSchema,
  CodePatternFindingSchema,
  LicenseFindingSchema,
]);
export type Finding = z.infer<typeof FindingSchema>;
export type FindingType = Finding['type'];
