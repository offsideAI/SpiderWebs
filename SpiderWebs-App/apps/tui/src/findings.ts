import { SEVERITY_RANK, type Finding, type Severity } from '@spiderwebs/schema';

export type SeverityFilter = Severity | 'all';

function epssPercentile(finding: Finding): number {
  return finding.type === 'dependency' ? (finding.advisory.epss?.percentile ?? 0) : 0;
}

/** Searchable text for a finding (package, version, advisory ids, title). */
export function searchText(finding: Finding): string {
  const parts = [finding.title];
  if (finding.type === 'dependency') {
    parts.push(finding.component.name, finding.component.version, finding.advisory.id);
    parts.push(...finding.advisory.aliases);
  }
  return parts.join(' ').toLowerCase();
}

/** Stable display order: severity desc, then EPSS desc, then title (PRD §5.9). */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      epssPercentile(b) - epssPercentile(a) ||
      a.title.localeCompare(b.title),
  );
}

export function filterFindings(
  findings: readonly Finding[],
  options: { severity?: SeverityFilter; query?: string } = {},
): Finding[] {
  const severity = options.severity ?? 'all';
  const query = (options.query ?? '').trim().toLowerCase();
  return findings.filter((finding) => {
    if (severity !== 'all' && finding.severity !== severity) return false;
    if (query && !searchText(finding).includes(query)) return false;
    return true;
  });
}

/** The list as rendered: filtered then sorted. */
export function visibleFindings(
  findings: readonly Finding[],
  options: { severity?: SeverityFilter; query?: string } = {},
): Finding[] {
  return sortFindings(filterFindings(findings, options));
}
