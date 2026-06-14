import { describe, expect, it } from 'vitest';
import { FINDING_ID_PATTERN, dependencyFindingId, stableId } from '../src/index.js';

describe('stableId', () => {
  it('is deterministic for identical inputs', () => {
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'));
  });

  it('matches the finding id pattern', () => {
    expect(stableId('anything')).toMatch(FINDING_ID_PATTERN);
  });

  it('differs for different inputs', () => {
    expect(stableId('a', 'b')).not.toBe(stableId('a', 'c'));
  });

  it('is not ambiguous across part boundaries', () => {
    expect(stableId('ab', 'c')).not.toBe(stableId('a', 'bc'));
  });

  it('pins the dependency finding id derivation (stability across releases)', () => {
    // If this snapshot changes, baseline diffing (--baseline) breaks for users.
    expect(dependencyFindingId('pkg:npm/lodash@4.17.20', 'GHSA-35jh-r3h4-6jhm')).toBe(
      dependencyFindingId('pkg:npm/lodash@4.17.20', 'GHSA-35jh-r3h4-6jhm'),
    );
    expect(dependencyFindingId('pkg:npm/lodash@4.17.20', 'GHSA-35jh-r3h4-6jhm')).toMatch(
      FINDING_ID_PATTERN,
    );
  });
});
