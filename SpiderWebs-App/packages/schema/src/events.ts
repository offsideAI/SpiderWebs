import { z } from 'zod';
import { FindingSchema } from './finding.js';
import { DataSourceNameSchema, ReportSummarySchema } from './report.js';

/** Pipeline stages in execution order (PRD §4, §8). */
export const STAGES = [
  'ingest',
  'deps',
  'secrets',
  'code',
  'licenses',
  'enrich',
  'correlate',
  'agent',
  'report',
] as const;

export const StageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof StageSchema>;

const eventBase = {
  /** Identifies the run; all events of one scan share it. */
  runId: z.string().min(1),
  at: z.iso.datetime(),
};

/**
 * Events emitted on the typed event bus (PRD §7.2). The TUI and the
 * headless/JSON renderers consume this same stream.
 */
export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run:start'), target: z.string().min(1) }),
  z.object({ ...eventBase, type: z.literal('stage:start'), stage: StageSchema }),
  z.object({
    ...eventBase,
    type: z.literal('stage:progress'),
    stage: StageSchema,
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive().optional(),
    message: z.string().optional(),
  }),
  z.object({ ...eventBase, type: z.literal('finding:new'), finding: FindingSchema }),
  z.object({
    ...eventBase,
    type: z.literal('stage:done'),
    stage: StageSchema,
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('source:status'),
    source: DataSourceNameSchema,
    status: z.enum(['ok', 'cache', 'unavailable', 'disabled']),
  }),
  z.object({
    ...eventBase,
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('error'),
    stage: StageSchema.optional(),
    message: z.string().min(1),
    /** Fatal errors abort the run (exit 2); non-fatal ones degrade gracefully. */
    fatal: z.boolean(),
  }),
  z.object({
    ...eventBase,
    type: z.literal('run:done'),
    exitCode: z.number().int().min(0).max(2),
    summary: ReportSummarySchema.optional(),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent['type'];
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;
