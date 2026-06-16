import type { Finding } from '@spiderwebs/schema';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { JSX } from 'react';
import {
  EPSS_MARK,
  HIGH_EPSS_PERCENTILE,
  KEV_MARK,
  SEVERITY_BADGE,
  SEVERITY_COLOR,
} from '../theme.js';
import type { SeverityFilter } from '../findings.js';

export interface FindingsViewProps {
  findings: Finding[];
  selectedIndex: number;
  severityFilter: SeverityFilter;
  query: string;
  searchMode: boolean;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
}

function isKev(finding: Finding): boolean {
  return finding.type === 'dependency' && Boolean(finding.advisory.kev?.listed);
}

function isHighEpss(finding: Finding): boolean {
  return (
    finding.type === 'dependency' &&
    (finding.advisory.epss?.percentile ?? 0) >= HIGH_EPSS_PERCENTILE
  );
}

function FindingRow({ finding, selected }: { finding: Finding; selected: boolean }): JSX.Element {
  const flags = `${isKev(finding) ? KEV_MARK : ' '}${isHighEpss(finding) ? EPSS_MARK : ' '}`;
  const label =
    finding.type === 'dependency'
      ? `${finding.component.name} ${finding.component.version}  ${finding.advisory.aliases[0] ?? finding.advisory.id}`
      : finding.title;

  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined}>{selected ? '▸ ' : '  '}</Text>
      <Text color={SEVERITY_COLOR[finding.severity]}>{SEVERITY_BADGE[finding.severity]} </Text>
      <Text color="yellow">{flags} </Text>
      <Text inverse={selected}>{label}</Text>
    </Box>
  );
}

function DetailPane({ finding }: { finding: Finding | undefined }): JSX.Element {
  if (!finding) {
    return (
      <Box>
        <Text dimColor>No findings match the current filter.</Text>
      </Box>
    );
  }
  if (finding.type !== 'dependency') {
    return (
      <Box flexDirection="column">
        <Text bold>{finding.title}</Text>
        <Text dimColor>severity {finding.severity}</Text>
      </Box>
    );
  }

  const a = finding.advisory;
  const fix = finding.fixedVersions[0];
  return (
    <Box flexDirection="column">
      <Text bold color={SEVERITY_COLOR[finding.severity]}>
        {finding.component.name} {finding.component.version}
        {fix ? <Text color="green">{`  →  ${fix}`}</Text> : null}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Detail label="Advisory" value={`${a.id}${a.aliases[0] ? `  (${a.aliases[0]})` : ''}`} />
        <Detail
          label="Severity"
          value={`${finding.severity}${a.cvss ? `  (CVSS ${a.cvss.score})` : ''}`}
        />
        {a.epss ? (
          <Detail
            label="EPSS"
            value={`${a.epss.score.toFixed(2)}  (${Math.round(a.epss.percentile * 100)}th pct)`}
          />
        ) : null}
        <Detail
          label="KEV"
          value={a.kev?.listed ? `${KEV_MARK} listed ${a.kev.dateAdded ?? ''}` : 'not listed'}
        />
        {a.cwes.length ? <Detail label="CWE" value={a.cwes.join(', ')} /> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Dependency path</Text>
        <Text> {finding.dependencyPath.join('  →  ')}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Summary</Text>
        <Text> {a.summary}</Text>
      </Box>
      {fix ? (
        <Box marginTop={1}>
          <Text color="green">Fix: </Text>
          <Text>{`upgrade ${finding.component.name} to ≥ ${fix}`}</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color="red">No upstream fix available yet.</Text>
        </Box>
      )}
    </Box>
  );
}

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Box>
      <Box width={10}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

export function FindingsView(props: FindingsViewProps): JSX.Element {
  const { findings, selectedIndex, severityFilter, query, searchMode } = props;
  const selected = findings[selectedIndex];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>filter: </Text>
        <Text color={severityFilter === 'all' ? 'gray' : SEVERITY_COLOR[severityFilter]}>
          {severityFilter}
        </Text>
        <Text dimColor>{'   search: '}</Text>
        {searchMode ? (
          <TextInput value={query} onChange={props.onQueryChange} onSubmit={props.onQuerySubmit} />
        ) : (
          <Text>{query ? query : <Text dimColor>(none)</Text>}</Text>
        )}
        <Text dimColor>{`   ${findings.length} shown`}</Text>
      </Box>
      <Box>
        <Box flexDirection="column" width={42} marginRight={2}>
          {findings.length === 0 ? (
            <Text dimColor>no matches</Text>
          ) : (
            findings.map((finding, i) => (
              <FindingRow key={finding.id} finding={finding} selected={i === selectedIndex} />
            ))
          )}
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <DetailPane finding={selected} />
        </Box>
      </Box>
    </Box>
  );
}
