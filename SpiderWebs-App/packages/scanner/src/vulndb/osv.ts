import {
  dependencyFindingId,
  type Advisory,
  type Component,
  type DependencyFinding,
  type Severity,
} from '@spiderwebs/schema';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { z } from 'zod';

export const OSV_DEFAULT_BASE_URL = 'https://api.osv.dev';
/** OSV accepts up to 1000 queries per batch request. */
const MAX_BATCH = 1000;

export class OsvUnavailableError extends Error {
  override name = 'OsvUnavailableError';
}

// --- OSV response schemas (validate external data at the boundary, PRD §7) ---

const OsvEventSchema = z
  .object({
    introduced: z.string().optional(),
    fixed: z.string().optional(),
    last_affected: z.string().optional(),
  })
  .loose();

const OsvAffectedSchema = z
  .object({
    package: z.object({ ecosystem: z.string().optional(), name: z.string().optional() }).optional(),
    ranges: z
      .array(z.object({ type: z.string().optional(), events: z.array(OsvEventSchema).default([]) }))
      .default([]),
    database_specific: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const OsvVulnSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    details: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    modified: z.string().optional(),
    published: z.string().optional(),
    references: z.array(z.object({ type: z.string().optional(), url: z.string() })).default([]),
    severity: z.array(z.object({ type: z.string(), score: z.string() })).default([]),
    affected: z.array(OsvAffectedSchema).default([]),
    database_specific: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export type OsvVuln = z.infer<typeof OsvVulnSchema>;

const OsvBatchResponseSchema = z.object({
  results: z.array(z.object({ vulns: z.array(z.object({ id: z.string() })).default([]) })),
});

export interface OsvClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Concurrent vulnerability-detail fetches. */
  concurrency?: number;
  retries?: number;
  timeoutMs?: number;
}

/** Thin transport over the OSV.dev API (PRD §6). All matching is done by OSV. */
export class OsvClient {
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #limit: ReturnType<typeof pLimit>;
  readonly #retries: number;
  readonly #timeoutMs: number;
  readonly #vulnCache = new Map<string, Promise<OsvVuln | undefined>>();

  constructor(options: OsvClientOptions = {}) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#baseUrl = (options.baseUrl ?? OSV_DEFAULT_BASE_URL).replace(/\/$/, '');
    this.#limit = pLimit(options.concurrency ?? 8);
    this.#retries = options.retries ?? 3;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async #request(path: string, init?: RequestInit): Promise<unknown> {
    return pRetry(
      async () => {
        const response = await this.#fetch(`${this.#baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (response.status === 404) return { __notFound: true };
        if (!response.ok) {
          throw new Error(`OSV ${path} responded ${response.status}`);
        }
        return response.json();
      },
      { retries: this.#retries, minTimeout: 250 },
    ).catch((error: unknown) => {
      throw new OsvUnavailableError(
        `OSV request failed (${path}): ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /** Batched lookup; returns vulnerability ids per component, index-aligned. */
  async queryBatch(components: readonly Component[]): Promise<string[][]> {
    const out: string[][] = [];
    for (let i = 0; i < components.length; i += MAX_BATCH) {
      const chunk = components.slice(i, i + MAX_BATCH);
      const body = {
        queries: chunk.map((c) => ({
          package: { name: c.name, ecosystem: c.ecosystem },
          version: c.version,
        })),
      };
      const json = await this.#request('/v1/querybatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed = OsvBatchResponseSchema.parse(json);
      for (const result of parsed.results) out.push(result.vulns.map((v) => v.id));
    }
    return out;
  }

  /** Fetch one vulnerability record (cached, concurrency-limited). */
  async getVuln(id: string): Promise<OsvVuln | undefined> {
    const cached = this.#vulnCache.get(id);
    if (cached) return cached;
    const promise = this.#limit(async () => {
      const json = await this.#request(`/v1/vulns/${encodeURIComponent(id)}`);
      if (json && typeof json === 'object' && '__notFound' in json) return undefined;
      return OsvVulnSchema.parse(json);
    });
    this.#vulnCache.set(id, promise);
    return promise;
  }
}

// --- mapping: OSV record -> SpiderWebs Advisory / Finding ---

const GHSA_SEVERITY: Record<string, Severity> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'medium',
  MEDIUM: 'medium',
  LOW: 'low',
};

export function osvSeverity(vuln: OsvVuln): Severity {
  const raw = vuln.database_specific?.severity;
  if (typeof raw === 'string') {
    const mapped = GHSA_SEVERITY[raw.toUpperCase()];
    if (mapped) return mapped;
  }
  return 'unknown';
}

function affectedFor(vuln: OsvVuln, name: string): OsvVuln['affected'][number] | undefined {
  return (
    vuln.affected.find((a) => a.package?.name === name) ??
    vuln.affected.find((a) => a.package?.name === undefined)
  );
}

export function osvFixedVersions(vuln: OsvVuln, name: string): string[] {
  const affected = affectedFor(vuln, name);
  if (!affected) return [];
  const fixed = new Set<string>();
  for (const range of affected.ranges) {
    for (const event of range.events) {
      if (event.fixed) fixed.add(event.fixed);
    }
  }
  return [...fixed];
}

function osvAffectedRanges(vuln: OsvVuln, name: string): string[] {
  const affected = affectedFor(vuln, name);
  if (!affected) return [];
  const ranges: string[] = [];
  for (const range of affected.ranges) {
    let introduced: string | undefined;
    for (const event of range.events) {
      if (event.introduced) introduced = event.introduced === '0' ? '0' : event.introduced;
      if (event.fixed) ranges.push(`>=${introduced ?? '0'} <${event.fixed}`);
      else if (event.last_affected) ranges.push(`>=${introduced ?? '0'} <=${event.last_affected}`);
    }
  }
  return ranges;
}

function osvCwes(vuln: OsvVuln): string[] {
  const ids = vuln.database_specific?.cwe_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((c): c is string => typeof c === 'string' && /^CWE-\d+$/.test(c));
}

function isoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export function osvVulnToAdvisory(vuln: OsvVuln, componentName: string): Advisory {
  return {
    id: vuln.id,
    aliases: vuln.aliases,
    source: 'osv',
    summary: vuln.summary ?? vuln.id,
    ...(vuln.details ? { details: vuln.details } : {}),
    severity: osvSeverity(vuln),
    cwes: osvCwes(vuln),
    affectedRanges: osvAffectedRanges(vuln, componentName),
    fixedVersions: osvFixedVersions(vuln, componentName),
    references: vuln.references
      .filter((r) => /^https?:\/\//.test(r.url))
      .map((r) => ({ url: r.url, ...(r.type ? { type: r.type } : {}) })),
    ...(isoOrUndefined(vuln.published) ? { published: isoOrUndefined(vuln.published) } : {}),
    ...(isoOrUndefined(vuln.modified) ? { modified: isoOrUndefined(vuln.modified) } : {}),
  };
}

/** Combine a component with an OSV record into a finding (PRD §5.2). */
export function osvVulnToFinding(component: Component, vuln: OsvVuln): DependencyFinding {
  const advisory = osvVulnToAdvisory(vuln, component.name);
  const primaryAlias = advisory.aliases.find((a) => a.startsWith('CVE-')) ?? advisory.id;
  return {
    id: dependencyFindingId(component.purl, advisory.id),
    type: 'dependency',
    severity: advisory.severity,
    title: `${component.name}@${component.version} — ${primaryAlias}`,
    component,
    advisory,
    fixedVersions: advisory.fixedVersions,
    dependencyPath: component.dependencyPaths[0] ?? [`${component.name}@${component.version}`],
  };
}
