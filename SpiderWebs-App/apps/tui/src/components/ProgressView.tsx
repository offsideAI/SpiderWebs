import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { JSX } from 'react';
import {
  DISPLAY_SEVERITIES,
  EPSS_MARK,
  KEV_MARK,
  SEVERITY_BADGE,
  SEVERITY_COLOR,
} from '../theme.js';
import type { RunState, StageView } from '../state.js';

const STAGE_LABEL: Record<StageView['stage'], string> = {
  ingest: 'Ingest',
  deps: 'Deps',
  secrets: 'Secrets',
  code: 'Code',
  licenses: 'Licenses',
  enrich: 'Enrich',
  correlate: 'Correlate',
  agent: 'Agent',
  report: 'Report',
};

function StageRow({ stage }: { stage: StageView }): JSX.Element {
  const icon =
    stage.status === 'done' ? (
      <Text color="green">✔</Text>
    ) : stage.status === 'active' ? (
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
    ) : (
      <Text dimColor>·</Text>
    );

  const detail =
    stage.status === 'done'
      ? (stage.message ??
        (stage.durationMs !== undefined ? `done in ${stage.durationMs}ms` : 'done'))
      : stage.status === 'active'
        ? stage.total
          ? `${stage.completed ?? 0}/${stage.total}`
          : (stage.message ?? 'working…')
        : 'waiting';

  return (
    <Box>
      <Box width={3}>{icon}</Box>
      <Box width={12}>
        <Text color={stage.status === 'pending' ? 'gray' : undefined}>
          {STAGE_LABEL[stage.stage]}
        </Text>
      </Box>
      <Text dimColor>{detail}</Text>
    </Box>
  );
}

function Counters({ state }: { state: RunState }): JSX.Element {
  return (
    <Box>
      {DISPLAY_SEVERITIES.map((severity) => (
        <Box key={severity} marginRight={2}>
          <Text color={SEVERITY_COLOR[severity]}>
            {SEVERITY_BADGE[severity]} {state.counts[severity]}{' '}
          </Text>
          <Text dimColor>{severity}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function ProgressView({ state }: { state: RunState }): JSX.Element {
  const highEpss = state.findings.filter(
    (f) => f.type === 'dependency' && (f.advisory.epss?.percentile ?? 0) >= 0.9,
  ).length;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        {state.stages.map((stage) => (
          <StageRow key={stage.stage} stage={stage} />
        ))}
      </Box>
      <Counters state={state} />
      <Box marginTop={1}>
        <Text color="yellow">
          {KEV_MARK} {state.kevCount} KEV
        </Text>
        <Text>{'   '}</Text>
        <Text color="yellow">
          {EPSS_MARK} {highEpss} high-EPSS
        </Text>
      </Box>
    </Box>
  );
}
