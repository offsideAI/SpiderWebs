import { SEVERITY_RANK, type Severity } from '@spiderwebs/schema';

/** Ink color names per severity (used for badges and list rows). */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'red',
  high: 'magenta',
  medium: 'yellow',
  low: 'cyan',
  info: 'gray',
  unknown: 'gray',
};

export const SEVERITY_BADGE: Record<Severity, string> = {
  critical: '◆',
  high: '▲',
  medium: '■',
  low: '•',
  info: '·',
  unknown: '?',
};

export const KEV_MARK = '★';
export const EPSS_MARK = '⚡';

/** EPSS at/above this percentile is flagged as "high-EPSS" in the UI. */
export const HIGH_EPSS_PERCENTILE = 0.9;

/** Severities in display order (most severe first), excluding info/unknown. */
export const DISPLAY_SEVERITIES: Severity[] = (
  ['critical', 'high', 'medium', 'low'] as Severity[]
).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]);

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
