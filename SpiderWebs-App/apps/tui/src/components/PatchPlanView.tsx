import { Box, Text } from 'ink';
import type { JSX } from 'react';
import { SEVERITY_COLOR } from '../theme.js';
import type { PatchStep } from '../patchPlan.js';

const RISK_BADGE: Record<PatchStep['risk'], { mark: string; color: string; label: string }> = {
  low: { mark: '●', color: 'green', label: 'low risk' },
  minor: { mark: '▲', color: 'yellow', label: 'minor bump' },
  major: { mark: '▲', color: 'red', label: 'major bump' },
};

function StepRow({ step, selected }: { step: PatchStep; selected: boolean }): JSX.Element {
  const risk = RISK_BADGE[step.risk];
  const upgrade = `${step.packageName}  ${step.fromVersions.join('/')} → ${step.toVersion}`;
  return (
    <Box>
      <Text color={selected ? 'cyan' : undefined}>{selected ? '▸ ' : '  '}</Text>
      <Box width={36}>
        <Text inverse={selected}>{`${step.order}. ${upgrade}`}</Text>
      </Box>
      <Box width={13}>
        <Text dimColor>{`resolves ${step.resolves}`}</Text>
      </Box>
      <Text color={risk.color}>
        {risk.mark} {risk.label}
      </Text>
    </Box>
  );
}

export function PatchPlanView({
  steps,
  selectedIndex,
}: {
  steps: PatchStep[];
  selectedIndex: number;
}): JSX.Element {
  const totalResolved = steps.reduce((sum, s) => sum + s.resolves, 0);
  const selected = steps[selectedIndex];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text>
          {steps.length} steps resolve <Text color="green">{totalResolved}</Text> findings
        </Text>
      </Box>
      <Box flexDirection="column">
        {steps.length === 0 ? (
          <Text dimColor>No fixable findings — nothing to patch.</Text>
        ) : (
          steps.map((step, i) => (
            <StepRow
              key={`${step.ecosystem}/${step.packageName}`}
              step={step}
              selected={i === selectedIndex}
            />
          ))
        )}
      </Box>
      {selected ? (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold>
            {`Step ${selected.order} · ${selected.packageName} ${selected.fromVersions.join('/')} → ${selected.toVersion}`}
          </Text>
          <Box marginTop={1} flexDirection="column">
            {selected.advisories.map((adv) => (
              <Text key={adv.id}>
                <Text color={SEVERITY_COLOR[adv.severity]}>● </Text>
                {`${adv.id} (${adv.severity})`}
              </Text>
            ))}
          </Box>
          {selected.risk === 'major' ? (
            <Box marginTop={1}>
              <Text color="red">
                ▲ Major version bump — review breaking changes before upgrading.
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
