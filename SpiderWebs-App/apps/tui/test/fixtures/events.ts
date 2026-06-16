import type { EventBus } from '@spiderwebs/core';
import {
  dependencyFindingId,
  type Advisory,
  type Component,
  type DependencyFinding,
  type RunEvent,
  type Severity,
} from '@spiderwebs/schema';

/**
 * Illustrative findings for the prototype. CVE ids are real, but severities,
 * scores, and dependency paths are hand-tuned for a varied demo — this module
 * is mock data, not a live scan. Replaced by the real pipeline in Milestone 1.
 */
interface MockSpec {
  name: string;
  version: string;
  fixed: string;
  cve: string;
  ghsa: string;
  severity: Severity;
  cvss: number;
  epss: number;
  epssPct: number;
  kev?: boolean;
  cwe: string;
  summary: string;
  path: string[];
  direct: boolean;
}

const SPECS: MockSpec[] = [
  {
    name: 'minimist',
    version: '1.2.5',
    fixed: '1.2.6',
    cve: 'CVE-2021-44906',
    ghsa: 'GHSA-xvch-5gv4-984h',
    severity: 'critical',
    cvss: 9.8,
    epss: 0.9,
    epssPct: 0.98,
    kev: true,
    cwe: 'CWE-1321',
    summary: 'Prototype pollution in minimist',
    path: ['app@1.0.0', 'mkdirp@0.5.1', 'minimist@1.2.5'],
    direct: false,
  },
  {
    name: 'shell-quote',
    version: '1.7.2',
    fixed: '1.7.3',
    cve: 'CVE-2021-42740',
    ghsa: 'GHSA-g4rg-993r-mgx7',
    severity: 'critical',
    cvss: 9.8,
    epss: 0.74,
    epssPct: 0.95,
    cwe: 'CWE-77',
    summary: 'Improper neutralization of special elements in shell-quote',
    path: ['app@1.0.0', 'shell-quote@1.7.2'],
    direct: true,
  },
  {
    name: 'lodash',
    version: '4.17.20',
    fixed: '4.17.21',
    cve: 'CVE-2021-23337',
    ghsa: 'GHSA-35jh-r3h4-6jhm',
    severity: 'high',
    cvss: 7.2,
    epss: 0.62,
    epssPct: 0.93,
    cwe: 'CWE-94',
    summary: 'Command injection via template in lodash',
    path: ['app@1.0.0', 'express@4.17.1', 'lodash@4.17.20'],
    direct: false,
  },
  {
    name: 'axios',
    version: '0.21.1',
    fixed: '0.21.2',
    cve: 'CVE-2021-3749',
    ghsa: 'GHSA-cph5-m8f7-6c5x',
    severity: 'high',
    cvss: 7.5,
    epss: 0.55,
    epssPct: 0.92,
    cwe: 'CWE-400',
    summary: 'Inefficient regular expression complexity (ReDoS) in axios',
    path: ['app@1.0.0', 'axios@0.21.1'],
    direct: true,
  },
  {
    name: 'y18n',
    version: '4.0.0',
    fixed: '4.0.1',
    cve: 'CVE-2020-7774',
    ghsa: 'GHSA-c4w7-xm78-47vh',
    severity: 'high',
    cvss: 7.7,
    epss: 0.21,
    epssPct: 0.84,
    cwe: 'CWE-1321',
    summary: 'Prototype pollution in y18n',
    path: ['app@1.0.0', 'yargs@15.4.0', 'y18n@4.0.0'],
    direct: false,
  },
  {
    name: 'node-fetch',
    version: '2.6.0',
    fixed: '2.6.7',
    cve: 'CVE-2022-0235',
    ghsa: 'GHSA-r683-j2x4-v87g',
    severity: 'medium',
    cvss: 6.1,
    epss: 0.08,
    epssPct: 0.71,
    cwe: 'CWE-200',
    summary: 'node-fetch forwards secure headers to untrusted sites on redirect',
    path: ['app@1.0.0', 'node-fetch@2.6.0'],
    direct: true,
  },
  {
    name: 'semver',
    version: '5.7.1',
    fixed: '5.7.2',
    cve: 'CVE-2022-25883',
    ghsa: 'GHSA-c2qf-rxjj-qqgw',
    severity: 'medium',
    cvss: 5.3,
    epss: 0.05,
    epssPct: 0.58,
    cwe: 'CWE-1333',
    summary: 'Regular expression denial of service in semver',
    path: ['app@1.0.0', 'nodemon@2.0.7', 'semver@5.7.1'],
    direct: false,
  },
  {
    name: 'json5',
    version: '1.0.1',
    fixed: '1.0.2',
    cve: 'CVE-2022-46175',
    ghsa: 'GHSA-9c47-m6qq-7p4h',
    severity: 'low',
    cvss: 3.7,
    epss: 0.03,
    epssPct: 0.41,
    cwe: 'CWE-1321',
    summary: 'Prototype pollution in JSON5 via parse',
    path: ['app@1.0.0', 'tsconfig-paths@3.12.0', 'json5@1.0.1'],
    direct: false,
  },
];

function buildFinding(spec: MockSpec): DependencyFinding {
  const purl = `pkg:npm/${spec.name}@${spec.version}`;
  const component: Component = {
    name: spec.name,
    version: spec.version,
    ecosystem: 'npm',
    purl,
    direct: spec.direct,
    scope: 'runtime',
    pinned: true,
    manifestPath: 'package-lock.json',
    dependencyPaths: [spec.path],
  };
  const advisory: Advisory = {
    id: spec.ghsa,
    aliases: [spec.cve],
    source: 'osv',
    summary: spec.summary,
    severity: spec.severity,
    cvss: {
      version: '3.1',
      score: spec.cvss,
      vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    },
    cwes: [spec.cwe],
    epss: { score: spec.epss, percentile: spec.epssPct },
    kev: { listed: spec.kev ?? false, ...(spec.kev ? { dateAdded: '2022-03-25' } : {}) },
    affectedRanges: [`< ${spec.fixed}`],
    fixedVersions: [spec.fixed],
    references: [{ url: `https://github.com/advisories/${spec.ghsa}` }],
  };
  return {
    id: dependencyFindingId(purl, advisory.id),
    type: 'dependency',
    severity: spec.severity,
    title: `${spec.name}@${spec.version} — ${spec.cve}`,
    component,
    advisory,
    fixedVersions: [spec.fixed],
    dependencyPath: spec.path,
  };
}

export const MOCK_FINDINGS: DependencyFinding[] = SPECS.map(buildFinding);

const RUN_ID = 'mock-run';
const TARGET = 'github.com/acme/widget-store';

/**
 * Build the ordered event stream for the demo. `baseTimeMs` keeps timestamps
 * deterministic for tests; the live demo passes Date.now().
 */
export function buildMockEvents(baseTimeMs = 0): RunEvent[] {
  let tick = 0;
  const at = (): string => new Date(baseTimeMs + tick++ * 1000).toISOString();
  const base = { runId: RUN_ID };
  const events: RunEvent[] = [];

  events.push({ ...base, type: 'run:start', at: at(), target: TARGET });

  events.push({ ...base, type: 'stage:start', at: at(), stage: 'ingest' });
  events.push({
    ...base,
    type: 'stage:done',
    at: at(),
    stage: 'ingest',
    durationMs: 1240,
  });

  events.push({ ...base, type: 'stage:start', at: at(), stage: 'deps' });
  events.push({
    ...base,
    type: 'stage:progress',
    at: at(),
    stage: 'deps',
    completed: 947,
    total: 947,
    message: '947 components (312 direct)',
  });
  events.push({ ...base, type: 'stage:done', at: at(), stage: 'deps', durationMs: 880 });

  events.push({ ...base, type: 'stage:start', at: at(), stage: 'enrich' });
  for (const source of ['osv', 'kev', 'epss', 'nvd'] as const) {
    events.push({
      ...base,
      type: 'source:status',
      at: at(),
      source,
      status: source === 'nvd' ? 'cache' : 'ok',
    });
  }
  // Findings stream in as enrichment matches them.
  for (const finding of MOCK_FINDINGS) {
    events.push({ ...base, type: 'finding:new', at: at(), finding });
  }
  events.push({ ...base, type: 'stage:done', at: at(), stage: 'enrich', durationMs: 2110 });

  events.push({
    ...base,
    type: 'log',
    at: at(),
    level: 'info',
    message: 'agent disabled (--no-agent)',
  });
  events.push({ ...base, type: 'stage:start', at: at(), stage: 'report' });
  events.push({ ...base, type: 'stage:done', at: at(), stage: 'report', durationMs: 60 });

  events.push({ ...base, type: 'run:done', at: at(), exitCode: 1 });
  return events;
}

export interface ReplayHandle {
  /** Stop any pending emissions (call on unmount). */
  stop: () => void;
}

/**
 * Emit the mock events onto a bus over wall-clock time so the demo animates.
 * `stepMs` is the gap between events; `onDone` fires after the last one.
 */
export function replayMockRun(
  bus: EventBus,
  options: { stepMs?: number; onDone?: () => void } = {},
): ReplayHandle {
  const { stepMs = 220, onDone } = options;
  const events = buildMockEvents(Date.now());
  const timers: ReturnType<typeof setTimeout>[] = [];

  events.forEach((event, i) => {
    timers.push(
      setTimeout(() => {
        // Re-stamp with the real current time so elapsed counters look live.
        bus.emit({ ...event, at: new Date().toISOString() });
        if (i === events.length - 1) onDone?.();
      }, i * stepMs),
    );
  });

  return {
    stop: () => {
      for (const t of timers) clearTimeout(t);
    },
  };
}
