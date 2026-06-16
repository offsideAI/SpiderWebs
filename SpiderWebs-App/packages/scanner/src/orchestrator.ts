import { randomUUID } from 'node:crypto';
import type { EventBus } from '@spiderwebs/core/bus';
import { determineExitCode, type ExitCode } from '@spiderwebs/core/exit';
import {
  summarizeFindings,
  type DataSourceStatus,
  type DependencyFinding,
  type FailOn,
  type Report,
  type RunEvent,
  type Stage,
  SEVERITY_RANK,
} from '@spiderwebs/schema';

/** Omit that distributes over the RunEvent union so discriminants are preserved. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EmitInput = DistributiveOmit<RunEvent, 'runId' | 'at'>;
import { discoverManifests, IngestError, prepareWorkspace, resolveTarget } from './ingest.js';
import { buildDependencyGraph } from './parsers/index.js';
import {
  OsvClient,
  OsvUnavailableError,
  osvVulnToFinding,
  type OsvClientOptions,
} from './vulndb/osv.js';

export interface RunScanOptions {
  target: string;
  cwd?: string;
  ref?: string;
  subdir?: string;
  offline?: boolean;
  keep?: boolean;
  failOn?: FailOn;
  toolVersion?: string;
  /** OSV client overrides (inject `fetch` in tests, point at a mock server). */
  osv?: OsvClientOptions;
}

export interface RunScanResult {
  report: Report;
  exitCode: ExitCode;
}

function sortFindings(findings: readonly DependencyFinding[]): DependencyFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.component.name.localeCompare(b.component.name) ||
      a.advisory.id.localeCompare(b.advisory.id),
  );
}

/**
 * The deterministic scan pipeline: ingest → parse → OSV lookup. Emits RunEvents
 * on the bus as it goes (consumed by the TUI and headless renderers alike) and
 * returns the machine report. Operational failures degrade gracefully — a dead
 * data source is marked unavailable rather than aborting the run (PRD §11).
 */
export async function runScan(options: RunScanOptions, bus: EventBus): Promise<RunScanResult> {
  const runId = randomUUID();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const failOn = options.failOn ?? 'none';

  const emit = (event: EmitInput): void =>
    bus.emit({ ...event, runId, at: new Date().toISOString() } as RunEvent);
  const stage = (s: Stage, fn: () => Promise<void>): Promise<void> => {
    emit({ type: 'stage:start', stage: s });
    const t0 = Date.now();
    return fn().then(() => emit({ type: 'stage:done', stage: s, durationMs: Date.now() - t0 }));
  };

  emit({ type: 'run:start', target: options.target });

  const dataSources: DataSourceStatus[] = [];
  const findings: DependencyFinding[] = [];
  const resolved = resolveTarget(options.target, options.cwd);
  let workspace: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;

  const finish = (exitCode: ExitCode): RunScanResult => {
    const finishedAtMs = Date.now();
    const sorted = sortFindings(findings);
    const report: Report = {
      schemaVersion: 1,
      tool: { name: 'spiderwebs', version: options.toolVersion ?? '0.1.0' },
      repo: {
        target: options.target,
        ...(resolved.url ? { url: resolved.url } : {}),
        ...(options.ref ? { ref: options.ref } : {}),
        ...(workspace?.commit ? { commit: workspace.commit } : {}),
        ...(options.subdir ? { subdir: options.subdir } : {}),
      },
      scan: {
        startedAt,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
      },
      dataSources,
      summary: summarizeFindings(sorted),
      components: [],
      findings: sorted,
      correlations: [],
      agent: { enabled: false },
    };
    emit({ type: 'run:done', exitCode, summary: report.summary });
    return { report, exitCode };
  };

  try {
    // --- ingest ---
    try {
      await stage('ingest', async () => {
        workspace = await prepareWorkspace(resolved, {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.ref ? { ref: options.ref } : {}),
          ...(options.keep ? { keep: options.keep } : {}),
          ...(options.offline ? { offline: options.offline } : {}),
        });
      });
    } catch (error) {
      const message = error instanceof IngestError ? error.message : String(error);
      emit({ type: 'error', stage: 'ingest', message, fatal: true });
      return finish(2);
    }

    // --- parse dependencies ---
    let componentList: Report['components'] = [];
    await stage('deps', async () => {
      const manifests = await discoverManifests(workspace!.root, {
        ...(options.subdir ? { subdir: options.subdir } : {}),
      });
      const graph = await buildDependencyGraph(manifests);
      componentList = graph.components;
      for (const err of graph.errors) {
        emit({ type: 'log', level: 'warn', message: `parse ${err.manifestPath}: ${err.message}` });
      }
      emit({
        type: 'stage:progress',
        stage: 'deps',
        completed: graph.components.length,
        message: `${graph.components.length} components from ${graph.manifestsParsed} manifest(s)`,
      });
    });

    // --- enrich via OSV ---
    await stage('enrich', async () => {
      if (options.offline) {
        dataSources.push({ name: 'osv', status: 'disabled' });
        emit({ type: 'source:status', source: 'osv', status: 'disabled' });
        emit({ type: 'log', level: 'warn', message: 'offline: skipping OSV lookup' });
        return;
      }
      if (componentList.length === 0) return;

      const client = new OsvClient(options.osv ?? {});
      try {
        const vulnIdsByComponent = await client.queryBatch(componentList);
        const uniqueIds = [...new Set(vulnIdsByComponent.flat())];
        emit({
          type: 'stage:progress',
          stage: 'enrich',
          completed: 0,
          total: Math.max(uniqueIds.length, 1),
          message: `${uniqueIds.length} advisories to resolve`,
        });
        dataSources.push({ name: 'osv', status: 'ok', snapshotAt: new Date().toISOString() });
        emit({ type: 'source:status', source: 'osv', status: 'ok' });

        let resolvedCount = 0;
        for (let i = 0; i < componentList.length; i++) {
          const component = componentList[i]!;
          for (const vulnId of vulnIdsByComponent[i] ?? []) {
            const vuln = await client.getVuln(vulnId);
            resolvedCount += 1;
            emit({
              type: 'stage:progress',
              stage: 'enrich',
              completed: resolvedCount,
              total: Math.max(uniqueIds.length, 1),
            });
            if (!vuln) continue;
            const finding = osvVulnToFinding(component, vuln);
            findings.push(finding);
            emit({ type: 'finding:new', finding });
          }
        }
      } catch (error) {
        if (error instanceof OsvUnavailableError) {
          dataSources.push({ name: 'osv', status: 'unavailable' });
          emit({ type: 'source:status', source: 'osv', status: 'unavailable' });
          emit({ type: 'error', stage: 'enrich', message: error.message, fatal: false });
          return;
        }
        throw error;
      }
    });

    // --- report ---
    await stage('report', async () => {
      // The deterministic report is assembled in finish(); nothing async here yet.
    });

    const result = finish(determineExitCode(findings, failOn));
    // Attach components after summary (kept out of finish() to preserve ordering).
    result.report.components = componentList;
    return result;
  } finally {
    await workspace?.cleanup().catch(() => {});
  }
}
