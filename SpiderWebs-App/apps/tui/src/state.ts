import {
  STAGES,
  emptySeverityCounts,
  summarizeFindings,
  type DataSourceName,
  type Finding,
  type RunEvent,
  type SeverityCounts,
  type Stage,
} from '@spiderwebs/schema';

export type StageStatus = 'pending' | 'active' | 'done';

export interface StageView {
  stage: Stage;
  status: StageStatus;
  message?: string;
  completed?: number;
  total?: number;
  durationMs?: number;
}

export type SourceStatus = 'pending' | 'ok' | 'cache' | 'unavailable' | 'disabled';

export interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/** Everything the views render, accumulated from the RunEvent stream. */
export interface RunState {
  runId?: string;
  target?: string;
  startedAt?: string;
  finishedAt?: string;
  stages: StageView[];
  sources: Partial<Record<DataSourceName, SourceStatus>>;
  findings: Finding[];
  counts: SeverityCounts;
  kevCount: number;
  logs: LogLine[];
  done: boolean;
  exitCode?: number;
  /** Set when a fatal error aborts the run (shown prominently in the UI). */
  fatalError?: string;
}

const MAX_LOG_LINES = 200;

export function initialRunState(): RunState {
  return {
    stages: STAGES.map((stage) => ({ stage, status: 'pending' })),
    sources: {},
    findings: [],
    counts: emptySeverityCounts(),
    kevCount: 0,
    logs: [],
    done: false,
  };
}

function setStage(stages: StageView[], stage: Stage, patch: Partial<StageView>): StageView[] {
  return stages.map((s) => (s.stage === stage ? { ...s, ...patch } : s));
}

/** Pure reducer: fold one RunEvent into the accumulated state (PRD §7.2). */
export function reduce(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'run:start':
      return { ...state, runId: event.runId, target: event.target, startedAt: event.at };

    case 'stage:start':
      return { ...state, stages: setStage(state.stages, event.stage, { status: 'active' }) };

    case 'stage:progress':
      return {
        ...state,
        stages: setStage(state.stages, event.stage, {
          status: 'active',
          completed: event.completed,
          ...(event.total !== undefined ? { total: event.total } : {}),
          ...(event.message !== undefined ? { message: event.message } : {}),
        }),
      };

    case 'stage:done':
      return {
        ...state,
        stages: setStage(state.stages, event.stage, {
          status: 'done',
          durationMs: event.durationMs,
        }),
      };

    case 'finding:new': {
      const findings = [...state.findings, event.finding];
      const summary = summarizeFindings(findings);
      return { ...state, findings, counts: summary.bySeverity, kevCount: summary.kevCount };
    }

    case 'source:status':
      return { ...state, sources: { ...state.sources, [event.source]: event.status } };

    case 'log':
      return {
        ...state,
        logs: [...state.logs, { level: event.level, message: event.message }].slice(-MAX_LOG_LINES),
      };

    case 'error':
      return {
        ...state,
        ...(event.fatal ? { fatalError: event.message } : {}),
        logs: [...state.logs, { level: 'error' as const, message: event.message }].slice(
          -MAX_LOG_LINES,
        ),
      };

    case 'run:done':
      return { ...state, done: true, exitCode: event.exitCode, finishedAt: event.at };

    default:
      return state;
  }
}

/** Fold an entire event list (used by tests and the headless fallback). */
export function reduceAll(events: readonly RunEvent[]): RunState {
  return events.reduce(reduce, initialRunState());
}
