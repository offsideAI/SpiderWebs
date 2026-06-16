import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  dedupeComponents,
  parseNpmLock,
  parsePnpmKey,
  parsePnpmLock,
  parseYarnLock,
  yarnSelectorName,
} from '../src/parsers/index.js';
import { makeComponent } from '../src/parsers/common.js';

const fixture = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url)), 'utf8');

describe('parseNpmLock', () => {
  const components = parseNpmLock(fixture('npm-project/package-lock.json'), 'package-lock.json');
  const byName = (name: string) => components.find((c) => c.name === name);

  it('extracts pinned versions for direct and transitive deps', () => {
    expect(byName('minimist')?.version).toBe('1.2.5');
    expect(byName('lodash')?.version).toBe('4.17.20');
    expect(byName('rimraf')?.version).toBe('3.0.2');
    expect(byName('glob')?.version).toBe('7.2.0');
  });

  it('marks top-level packages direct and nested ones transitive', () => {
    expect(byName('minimist')?.direct).toBe(true);
    expect(byName('lodash')?.direct).toBe(true);
    expect(byName('glob')?.direct).toBe(false); // nested under rimraf
  });

  it('captures dev scope', () => {
    expect(byName('rimraf')?.scope).toBe('development');
    expect(byName('minimist')?.scope).toBe('runtime');
  });

  it('builds a purl', () => {
    expect(byName('lodash')?.purl).toBe('pkg:npm/lodash@4.17.20');
  });

  it('does not include the root package', () => {
    expect(components.some((c) => c.name === 'fixture-npm-project')).toBe(false);
  });
});

describe('parsePnpmKey', () => {
  it('handles v6 name@version', () => {
    expect(parsePnpmKey('/minimist@1.2.5')).toEqual({ name: 'minimist', version: '1.2.5' });
  });
  it('handles scoped names', () => {
    expect(parsePnpmKey('/@babel/core@7.20.0')).toEqual({ name: '@babel/core', version: '7.20.0' });
  });
  it('strips peer-dependency suffixes', () => {
    expect(parsePnpmKey('/react-dom@18.2.0(react@18.2.0)')).toEqual({
      name: 'react-dom',
      version: '18.2.0',
    });
  });
  it('handles v5 name/version', () => {
    expect(parsePnpmKey('/minimist/1.2.5')).toEqual({ name: 'minimist', version: '1.2.5' });
  });
});

describe('parsePnpmLock', () => {
  const components = parsePnpmLock(fixture('pnpm-project/pnpm-lock.yaml'), 'pnpm-lock.yaml');
  const byName = (name: string) => components.find((c) => c.name === name);

  it('parses packages including scoped ones', () => {
    expect(byName('minimist')?.version).toBe('1.2.5');
    expect(byName('lodash')?.version).toBe('4.17.20');
    expect(byName('@babel/core')?.version).toBe('7.20.0');
  });

  it('marks declared dependencies direct', () => {
    expect(byName('minimist')?.direct).toBe(true); // in dependencies
    expect(byName('lodash')?.direct).toBe(false); // transitive
    expect(byName('rimraf')?.direct).toBe(true); // in devDependencies
  });
});

describe('parseYarnLock (v1)', () => {
  const components = parseYarnLock(fixture('yarn-project/yarn.lock'), 'yarn.lock');
  const byName = (name: string) => components.find((c) => c.name === name);

  it('parses single and multi-selector blocks', () => {
    expect(byName('minimist')?.version).toBe('1.2.5');
    expect(byName('lodash')?.version).toBe('4.17.20');
  });

  it('parses scoped packages', () => {
    expect(byName('@babel/core')?.version).toBe('7.20.0');
  });
});

describe('yarnSelectorName', () => {
  it.each([
    ['lodash@^4.17.0', 'lodash'],
    ['"@babel/core@^7.0.0"', '@babel/core'],
    ['lodash@npm:^4.17.0', 'lodash'],
  ])('extracts %s -> %s', (selector, name) => {
    expect(yarnSelectorName(selector)).toBe(name);
  });
});

describe('dedupeComponents', () => {
  it('prefers the direct record when a package appears twice', () => {
    const transitive = makeComponent({
      name: 'lodash',
      version: '4.17.20',
      ecosystem: 'npm',
      direct: false,
      manifestPath: 'a',
    });
    const direct = makeComponent({
      name: 'lodash',
      version: '4.17.20',
      ecosystem: 'npm',
      direct: true,
      manifestPath: 'b',
    });
    const deduped = dedupeComponents([transitive, direct]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.direct).toBe(true);
  });
});
