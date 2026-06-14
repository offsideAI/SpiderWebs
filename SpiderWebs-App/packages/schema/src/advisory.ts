import { z } from 'zod';
import { SeveritySchema } from './severity.js';

export const CvssSchema = z.object({
  version: z.enum(['2.0', '3.0', '3.1', '4.0']),
  score: z.number().min(0).max(10),
  vector: z.string().min(1),
});
export type Cvss = z.infer<typeof CvssSchema>;

/** EPSS exploitation probability from FIRST (PRD §5.7). */
export const EpssSchema = z.object({
  score: z.number().min(0).max(1),
  percentile: z.number().min(0).max(1),
  date: z.iso.date().optional(),
});
export type Epss = z.infer<typeof EpssSchema>;

/** CISA Known Exploited Vulnerabilities membership (PRD §5.7). */
export const KevSchema = z.object({
  listed: z.boolean(),
  dateAdded: z.iso.date().optional(),
  dueDate: z.iso.date().optional(),
  knownRansomwareUse: z.boolean().optional(),
});
export type Kev = z.infer<typeof KevSchema>;

export const AdvisoryReferenceSchema = z.object({
  url: z.url(),
  type: z.string().optional(),
});
export type AdvisoryReference = z.infer<typeof AdvisoryReferenceSchema>;

export const AdvisorySourceSchema = z.enum(['osv', 'ghsa', 'nvd']);
export type AdvisorySource = z.infer<typeof AdvisorySourceSchema>;

/** A vulnerability advisory, normalized across OSV/GHSA/NVD (PRD §5.2, §6). */
export const AdvisorySchema = z.object({
  /** Canonical advisory id (CVE-..., GHSA-..., or OSV id). */
  id: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  source: AdvisorySourceSchema,
  summary: z.string(),
  details: z.string().optional(),
  severity: SeveritySchema,
  cvss: CvssSchema.optional(),
  cwes: z.array(z.string().regex(/^CWE-\d+$/)).default([]),
  epss: EpssSchema.optional(),
  kev: KevSchema.optional(),
  /** Human-readable affected version ranges as reported by the source. */
  affectedRanges: z.array(z.string()).default([]),
  /** First fixed version(s) per affected range; empty when no fix exists. */
  fixedVersions: z.array(z.string()).default([]),
  references: z.array(AdvisoryReferenceSchema).default([]),
  published: z.iso.datetime().optional(),
  modified: z.iso.datetime().optional(),
});
export type Advisory = z.infer<typeof AdvisorySchema>;
