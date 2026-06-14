import { z } from 'zod';
import { FINDING_ID_PATTERN } from './finding.js';

/** What a GitHub issue was correlated against (PRD §5.6). */
export const CorrelationTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('finding'),
    findingId: z.string().regex(FINDING_ID_PATTERN),
  }),
  z.object({
    kind: z.literal('code'),
    paths: z.array(z.string().min(1)).min(1),
  }),
]);
export type CorrelationTarget = z.infer<typeof CorrelationTargetSchema>;

export const CorrelationRelationshipSchema = z.enum([
  /** Issue describes a known CVE already surfaced by SCA. */
  'confirms-finding',
  /** Issue describes a latent security problem with no CVE, mapped to code. */
  'describes-latent-risk',
  /** Issue mentions an advisory id without a matching finding in scope. */
  'mentions-advisory',
]);
export type CorrelationRelationship = z.infer<typeof CorrelationRelationshipSchema>;

/** One row of the issue ↔ finding/code correlation table (PRD §5.6). */
export const CorrelationSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueTitle: z.string(),
  issueUrl: z.url(),
  target: CorrelationTargetSchema,
  relationship: CorrelationRelationshipSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});
export type Correlation = z.infer<typeof CorrelationSchema>;
