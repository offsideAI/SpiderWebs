import type { EventBus } from '@spiderwebs/core';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useMemo, useReducer, useState, type JSX } from 'react';
import { visibleFindings, type SeverityFilter } from '../findings.js';
import { derivePatchPlan } from '../patchPlan.js';
import { initialRunState, reduce } from '../state.js';
import { formatDuration } from '../theme.js';
import { FindingsView } from './FindingsView.js';
import { PatchPlanView } from './PatchPlanView.js';
import { ProgressView } from './ProgressView.js';

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

  useInput((input, key) => {
    if (!target) {
      if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
        if (exitOnQuit) exit();
      }
      return;
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
    }

    if (view === 'patch') {
      if (up) return setPatchIndex((i) => clamp(i - 1, patchSteps.length - 1));
      if (down) return setPatchIndex((i) => clamp(i + 1, patchSteps.length - 1));
      if (input === 'e') return flash('exported patch plan (demo: no file written)');
      if (input === 'c') return flash('copied patch plan to clipboard (demo)');
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
        <Text marginTop={1}>Please enter a repository path, local folder, or Git URL to scan:</Text>
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
      />
      <Box marginTop={1} flexDirection="column">
        {showHelp ? (
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
}: {
  target?: string;
  status: 'scanning' | 'done';
  elapsed: string;
  view: View;
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
        <Text color={status === 'done' ? 'green' : 'yellow'}>
          {status === 'done' ? '✔ done' : '⠿ scanning'}
        </Text>
        <Text dimColor>{`  ${elapsed}  ·  ${VIEW_TITLE[view]}`}</Text>
      </Box>
    </Box>
  );
}

function tabHints(view: View): string {
  const common = 'tab views · ? help · q quit';
  if (view === 'findings')
    return `↑↓/jk move · f filter · / search · o open · e export · ${common}`;
  if (view === 'patch') return `↑↓/jk move · e export · c copy · ${common}`;
  return `1/2/3 jump · ${common}`;
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
