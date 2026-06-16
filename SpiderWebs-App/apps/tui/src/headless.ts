import type { Writable } from 'node:stream';
import { EventBus } from '@spiderwebs/core/bus';
import { runScan, type RunScanOptions } from '@spiderwebs/scanner';
import { visibleFindings } from './findings.js';
import { derivePatchPlan } from './patchPlan.js';
import { initialRunState, reduce, type RunState } from './state.js';
import { DISPLAY_SEVERITIES, SEVERITY_BADGE } from './theme.js';

/**
 * Plain, non-interactive rendering of a run for dumb terminals / piped output /
 * CI (PRD §8 graceful degradation). Renders from the same RunState the Ink app
 * builds, so interactive and headless output never drift apart.
 */
export function printState(out: Writable, state: RunState): void {
  out.write(`SpiderWebs — ${state.target ?? 'scan'}\n`);
  if (state.fatalError) {
    out.write(`\nERROR: ${state.fatalError}\n`);
    return;
  }

  out.write('\nStages\n');
  for (const stage of state.stages) {
    const mark = stage.status === 'done' ? 'done' : stage.status === 'active' ? '…' : 'skipped';
    out.write(`  - ${stage.stage}: ${mark}\n`);
  }

  out.write('\nFindings by severity\n');
  for (const severity of DISPLAY_SEVERITIES) {
    out.write(`  ${SEVERITY_BADGE[severity]} ${severity}: ${state.counts[severity]}\n`);
  }
  out.write(`  KEV: ${state.kevCount}\n`);

  const findings = visibleFindings(state.findings);
  out.write(`\nFindings (${findings.length})\n`);
  if (findings.length === 0) {
    out.write('  none\n');
  }
  for (const finding of findings) {
    if (finding.type !== 'dependency') continue;
    const fix = finding.fixedVersions[0] ? ` → ${finding.fixedVersions[0]}` : ' (no fix)';
    out.write(
      `  [${finding.severity}] ${finding.component.name} ${finding.component.version}${fix}  ${finding.advisory.aliases[0] ?? finding.advisory.id}\n`,
    );
  }

  const plan = derivePatchPlan(state.findings);
  if (plan.length > 0) {
    out.write('\nPatch plan\n');
    for (const step of plan) {
      out.write(
        `  ${step.order}. ${step.packageName} ${step.fromVersions.join('/')} → ${step.toVersion}  (resolves ${step.resolves}, ${step.risk} risk)\n`,
      );
    }
  }
}

/** Run a real scan and print the result without the interactive UI. */
export async function runHeadlessScan(out: Writable, options: RunScanOptions): Promise<number> {
  const bus = new EventBus();
  let state = initialRunState();
  const off = bus.onAny((event) => {
    state = reduce(state, event);
  });
  try {
    const { exitCode } = await runScan(options, bus);
    printState(out, state);
    return exitCode;
  } finally {
    off();
  }
}
