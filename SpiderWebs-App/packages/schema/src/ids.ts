import { createHash } from 'node:crypto';

const SEPARATOR = String.fromCharCode(0);

/**
 * Content-derived stable id: identical inputs always yield the same id, so
 * findings keep their identity across runs and reports diff cleanly
 * (PRD §5.9, `--baseline`). Parts are NUL-joined to prevent ambiguity
 * between e.g. `("ab","c")` and `("a","bc")`.
 */
export function stableId(...parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join(SEPARATOR)).digest('hex');
  return `sw-${digest.slice(0, 16)}`;
}

/** Stable id for a dependency-vulnerability finding. */
export function dependencyFindingId(purl: string, advisoryId: string): string {
  return stableId('dependency', purl, advisoryId);
}
