import type { EventBus } from '@spiderwebs/core';
import type { FixConsentSummary, FixEvent, RunFixResult } from '@spiderwebs/scanner';
import type { DependencyFinding } from '@spiderwebs/schema';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { useEffect, useMemo, useReducer, useState, type JSX } from 'react';
import { visibleFindings, type SeverityFilter } from '../findings.js';
import { derivePatchPlan } from '../patchPlan.js';
import { initialRunState, reduce } from '../state.js';
import { formatDuration } from '../theme.js';
import { FindingsView } from './FindingsView.js';
import { PatchPlanView } from './PatchPlanView.js';
import { ProgressView } from './ProgressView.js';

/** Request passed to the host to run a guided fix (PRD §5.11). */
export interface FixRequest {
  target: string;
  findings: DependencyFinding[];
  /** When true, commit + preview only — never push or open a PR. */
  dryRun: boolean;
  confirm: (summary: FixConsentSummary) => Promise<boolean>;
  onEvent: (event: FixEvent) => void;
}

type FixSession =
  | { phase: 'running'; pkg: string }
  | { phase: 'confirm'; pkg: string; summary: FixConsentSummary; resolve: (ok: boolean) => void }
  | { phase: 'done'; pkg: string; result: RunFixResult };

type View = 'progress' | 'findings' | 'patch';
const VIEW_ORDER: View[] = ['progress', 'findings', 'patch'];
const VIEW_TITLE: Record<View, string> = {
  progress: 'Scan progress',
  findings: 'Findings',
  patch: 'Patch plan',
};
const FILTER_CYCLE: SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low'];

export interface AppProps {
  bus: EventBus;
  /** The initial target to scan (if provided on CLI). */
  initialTarget?: string;
  /** Callback triggered when the user enters a Git URL/path in TUI. */
  onStartScan?: (target: string) => void;
  /** Runs a guided fix for a package (wired to runFix by the host). */
  onFix?: (request: FixRequest) => Promise<RunFixResult>;
  /** Start with dry-run mode on (the `--dry-run` launch flag). */
  initialDryRun?: boolean;
  /** Disable real-process exit on quit (tests drive unmount themselves). */
  exitOnQuit?: boolean;
}

function clamp(value: number, max: number): number {
  if (max < 0) return 0;
  return Math.max(0, Math.min(value, max));
}

export function App({
  bus,
  initialTarget,
  onStartScan,
  onFix,
  initialDryRun = false,
  exitOnQuit = true,
}: AppProps): JSX.Element {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reduce, undefined, initialRunState);

  const [target, setTarget] = useState<string | undefined>(initialTarget);
  const [inputVal, setInputVal] = useState('');

  const [view, setView] = useState<View>('progress');
  const [findingsIndex, setFindingsIndex] = useState(0);
  const [patchIndex, setPatchIndex] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  const [, forceTick] = useState(0);
  const [fixSession, setFixSession] = useState<FixSession | null>(null);
  const [fixLog, setFixLog] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState(initialDryRun);

  // Subscribe to the same event bus the headless renderer consumes (PRD §7.2).
  useEffect(() => bus.onAny(dispatch), [bus]);

  // Tick the elapsed clock while the run is in flight.
  useEffect(() => {
    if (state.done) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [state.done]);

  // Land on the findings view once the scan finishes (unless it found nothing
  // or aborted — then stay on progress, which shows the status/error).
  const hasFindings = state.findings.length > 0;
  useEffect(() => {
    if (state.done && hasFindings) {
      setView((current) => (current === 'progress' ? 'findings' : current));
    }
  }, [state.done, hasFindings]);

  const findings = useMemo(
    () => visibleFindings(state.findings, { severity: severityFilter, query }),
    [state.findings, severityFilter, query],
  );
  const patchSteps = useMemo(() => derivePatchPlan(state.findings), [state.findings]);

  const flash = (message: string): void => setToast(message);

  const startFix = (packageName: string): void => {
    if (!onFix || !target) return flash('fix is unavailable');
    const pkgFindings = state.findings.filter(
      (f): f is DependencyFinding =>
        f.type === 'dependency' && f.component.name === packageName && f.fixedVersions.length > 0,
    );
    if (pkgFindings.length === 0) return flash('no fixable finding for this package');

    setFixLog([]);
    setFixSession({ phase: 'running', pkg: packageName });
    const append = (line: string): void => setFixLog((log) => [...log, line].slice(-300));
    void onFix({
      target,
      findings: pkgFindings,
      dryRun,
      confirm: (summary) =>
        new Promise<boolean>((resolve) => {
          setFixSession({ phase: 'confirm', pkg: packageName, summary, resolve });
        }),
      onEvent: (event) => {
        if (event.type === 'fix:step') append(`▸ ${event.message}`);
        else if (event.type === 'fix:log') append(`  ${event.message}`);
      },
    })
      .then((result) => setFixSession({ phase: 'done', pkg: packageName, result }))
      .catch((error: unknown) =>
        setFixSession({
          phase: 'done',
          pkg: packageName,
          result: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
  };

  useInput((input, key) => {
    if (!target) {
      if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
        if (exitOnQuit) exit();
      }
      return;
    }

    // A fix in progress owns all input until it resolves or is dismissed.
    if (fixSession) {
      if (fixSession.phase === 'confirm') {
        if (input === 'y' || input === 'Y') {
          fixSession.resolve(true);
          setFixSession({ phase: 'running', pkg: fixSession.pkg });
        } else if (input === 'n' || input === 'N' || key.escape || key.return) {
          fixSession.resolve(false);
          setFixSession({ phase: 'running', pkg: fixSession.pkg });
        }
      } else if (fixSession.phase === 'done') {
        setFixSession(null); // any key dismisses the result
        setFixLog([]);
      }
      return; // 'running' ignores input (no abort mid-flight)
    }

    // While typing a search query, only Escape/Enter are meaningful here;
    // the rest goes to the focused TextInput.
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setQuery('');
        setFindingsIndex(0);
      }
      return;
    }

    if (showHelp) {
      setShowHelp(false);
      return;
    }

    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      if (exitOnQuit) exit();
      return;
    }
    if (input === '?') {
      setShowHelp(true);
      return;
    }
    if (input === 'D') {
      setDryRun((on) => !on);
      flash(
        dryRun ? 'dry-run off — fixes will push after confirm' : 'dry-run on — fixes preview only',
      );
      return;
    }
    if (key.tab) {
      setView((v) => VIEW_ORDER[(VIEW_ORDER.indexOf(v) + 1) % VIEW_ORDER.length]!);
      return;
    }
    if (input === '1') return setView('progress');
    if (input === '2') return setView('findings');
    if (input === '3') return setView('patch');

    const up = key.upArrow || input === 'k';
    const down = key.downArrow || input === 'j';

    if (view === 'findings') {
      if (up) return setFindingsIndex((i) => clamp(i - 1, findings.length - 1));
      if (down) return setFindingsIndex((i) => clamp(i + 1, findings.length - 1));
      if (input === 'f') {
        const next =
          FILTER_CYCLE[(FILTER_CYCLE.indexOf(severityFilter) + 1) % FILTER_CYCLE.length]!;
        setSeverityFilter(next);
        setFindingsIndex(0);
        return;
      }
      if (input === '/') {
        setSearchMode(true);
        return;
      }
      if (input === 'o') {
        const selected = findings[findingsIndex];
        const url =
          selected?.type === 'dependency' ? selected.advisory.references[0]?.url : undefined;
        return flash(url ? `open ${url}` : 'no advisory URL for this finding');
      }
      if (input === 'e')
        return flash('exported findings → spiderwebs-out/ (demo: no file written)');
      if (input === 'F') {
        const selected = findings[clamp(findingsIndex, findings.length - 1)];
        if (selected?.type !== 'dependency') return flash('not a dependency finding');
        return startFix(selected.component.name);
      }
    }

    if (view === 'patch') {
      if (up) return setPatchIndex((i) => clamp(i - 1, patchSteps.length - 1));
      if (down) return setPatchIndex((i) => clamp(i + 1, patchSteps.length - 1));
      if (input === 'e') return flash('exported patch plan (demo: no file written)');
      if (input === 'c') return flash('copied patch plan to clipboard (demo)');
      if (input === 'F') {
        const step = patchSteps[clamp(patchIndex, patchSteps.length - 1)];
        if (!step) return flash('no patch step selected');
        return startFix(step.packageName);
      }
    }
  });

  const elapsedMs = state.startedAt
    ? (state.done && state.finishedAt ? Date.parse(state.finishedAt) : Date.now()) -
      Date.parse(state.startedAt)
    : 0;
  const clampedFindingsIndex = clamp(findingsIndex, findings.length - 1);
  const clampedPatchIndex = clamp(patchIndex, patchSteps.length - 1);

  if (!target) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          SpiderWebs — Security Scanner
        </Text>
        <Box marginTop={1}>
          <Text>Please enter a repository path, local folder, or Git URL to scan:</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={inputVal}
            onChange={setInputVal}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed) {
                setTarget(trimmed);
                onStartScan?.(trimmed);
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Esc or q to quit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        target={state.target}
        status={state.done ? 'done' : 'scanning'}
        elapsed={formatDuration(elapsedMs)}
        view={view}
        dryRun={dryRun}
      />
      <Box marginTop={1} flexDirection="column">
        {fixSession ? (
          <FixOverlay session={fixSession} log={fixLog} />
        ) : showHelp ? (
          <HelpOverlay />
        ) : view === 'progress' ? (
          <ProgressView state={state} />
        ) : view === 'findings' ? (
          <FindingsView
            findings={findings}
            selectedIndex={clampedFindingsIndex}
            severityFilter={severityFilter}
            query={query}
            searchMode={searchMode}
            onQueryChange={(value) => {
              setQuery(value);
              setFindingsIndex(0);
            }}
            onQuerySubmit={() => setSearchMode(false)}
          />
        ) : (
          <PatchPlanView steps={patchSteps} selectedIndex={clampedPatchIndex} />
        )}
      </Box>
      <Footer
        view={view}
        toast={toast}
        done={state.done}
        exitCode={state.exitCode}
        fatalError={state.fatalError}
        emptyResult={state.done && !hasFindings && !state.fatalError}
      />
    </Box>
  );
}

function Header({
  target,
  status,
  elapsed,
  view,
  dryRun,
}: {
  target?: string;
  status: 'scanning' | 'done';
  elapsed: string;
  view: View;
  dryRun: boolean;
}): JSX.Element {
  return (
    <Box justifyContent="space-between">
      <Box>
        <Text bold color="cyan">
          SpiderWebs{' '}
        </Text>
        <Text dimColor>{target ?? 'starting…'}</Text>
      </Box>
      <Box>
        {dryRun ? <Text color="cyan">DRY-RUN · </Text> : null}
        <Text color={status === 'done' ? 'green' : 'yellow'}>
          {status === 'done' ? '✔ done' : '⠿ scanning'}
        </Text>
        <Text dimColor>{`  ${elapsed}  ·  ${VIEW_TITLE[view]}`}</Text>
      </Box>
    </Box>
  );
}

function tabHints(view: View): string {
  const common = 'tab views · D dry-run · ? help · q quit';
  if (view === 'findings') return `↑↓/jk move · F fix · f filter · / search · ${common}`;
  if (view === 'patch') return `↑↓/jk move · F fix · e export · ${common}`;
  return `1/2/3 jump · ${common}`;
}

function truncateDiff(diff: string, maxLines = 16): string[] {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`];
}

const FIX_STATUS_COLOR: Record<RunFixResult['status'], string> = {
  'opened-pr': 'green',
  'updated-pr': 'green',
  committed: 'yellow',
  'dry-run': 'cyan',
  'gh-unavailable': 'yellow',
  skipped: 'gray',
  error: 'red',
};

/** Scrolling tail of the fix activity log (newest at the bottom). */
function ActivityLog({ log, rows = 14 }: { log: string[]; rows?: number }): JSX.Element {
  const tail = log.slice(-rows);
  const hidden = log.length - tail.length;
  return (
    <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>Activity log</Text>
      {hidden > 0 ? <Text dimColor>… {hidden} earlier line(s)</Text> : null}
      {tail.length === 0 ? (
        <Text dimColor> starting…</Text>
      ) : (
        tail.map((line, i) => (
          <Text
            key={i}
            color={line.startsWith('▸') ? 'cyan' : undefined}
            dimColor={!line.startsWith('▸')}
          >
            {line || ' '}
          </Text>
        ))
      )}
    </Box>
  );
}

function FixOverlay({ session, log }: { session: FixSession; log: string[] }): JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        Guided fix — {session.pkg}
      </Text>

      <ActivityLog log={log} />

      {session.phase === 'running' ? (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> working…</Text>
        </Box>
      ) : session.phase === 'confirm' ? (
        <Box marginTop={1} flexDirection="column">
          <Text>
            Upgrade {session.summary.packageName} {session.summary.fromVersion} →{' '}
            <Text color="green">{session.summary.toVersion}</Text>, push{' '}
            <Text color="yellow">{session.summary.branch}</Text>, and open a PR to{' '}
            <Text bold>{session.summary.target}</Text>?
          </Text>
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            {truncateDiff(session.summary.diff).map((line, i) => (
              <Text
                key={i}
                color={line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : undefined}
                dimColor={!line.startsWith('+') && !line.startsWith('-')}
              >
                {line || ' '}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text color="green">[y]</Text>
            <Text> push &amp; open PR </Text>
            <Text color="red">[n]</Text>
            <Text> cancel (keep the local commit)</Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={FIX_STATUS_COLOR[session.result.status]}>
            {session.result.status}: {session.result.message}
          </Text>
          {session.result.diff ? (
            <Box
              marginTop={1}
              flexDirection="column"
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
            >
              {truncateDiff(session.result.diff).map((line, i) => (
                <Text
                  key={i}
                  color={line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : undefined}
                  dimColor={!line.startsWith('+') && !line.startsWith('-')}
                >
                  {line || ' '}
                </Text>
              ))}
            </Box>
          ) : null}
          {session.result.prUrl ? <Text>{session.result.prUrl}</Text> : null}
          {session.result.workspacePath ? (
            <Text dimColor>workspace: {session.result.workspacePath}</Text>
          ) : null}
          <Box marginTop={1}>
            <Text dimColor>press any key to continue</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function Footer({
  view,
  toast,
  done,
  exitCode,
  fatalError,
  emptyResult,
}: {
  view: View;
  toast?: string;
  done: boolean;
  exitCode?: number;
  fatalError?: string;
  emptyResult?: boolean;
}): JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      {fatalError ? (
        <Text color="red">✖ {fatalError}</Text>
      ) : toast ? (
        <Text color="cyan">» {toast}</Text>
      ) : emptyResult ? (
        <Text color="green">✔ No known vulnerabilities found in scope.</Text>
      ) : done ? (
        <Text dimColor>
          run complete · exit code {exitCode ?? 0}
          {exitCode === 1 ? ' (findings at/above threshold)' : ''}
        </Text>
      ) : null}
      <Text dimColor>{tabHints(view)}</Text>
    </Box>
  );
}

function HelpOverlay(): JSX.Element {
  const rows: [string, string][] = [
    ['tab', 'cycle views'],
    ['1 / 2 / 3', 'jump to progress / findings / patch'],
    ['↑ ↓ or j k', 'move selection'],
    ['f', 'cycle severity filter (findings)'],
    ['/', 'fuzzy search (findings); Esc cancels'],
    ['o', 'open advisory URL (findings)'],
    ['e', 'export report'],
    ['c', 'copy patch plan (patch)'],
    ['F', 'fix selected package → PR (findings / patch)'],
    ['D', 'toggle dry-run (preview fixes, no push)'],
    ['? ', 'toggle this help'],
    ['q', 'quit'],
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Keyboard shortcuts</Text>
      <Box marginTop={1} flexDirection="column">
        {rows.map(([keys, desc]) => (
          <Box key={keys}>
            <Box width={12}>
              <Text color="cyan">{keys}</Text>
            </Box>
            <Text>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>press any key to close</Text>
      </Box>
    </Box>
  );
}
