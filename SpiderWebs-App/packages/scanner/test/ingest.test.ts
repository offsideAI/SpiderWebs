import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IngestError, discoverManifests, resolveTarget, resolveWithin } from '../src/ingest.js';

const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('resolveTarget', () => {
  it('classifies local paths', () => {
    expect(resolveTarget('.').kind).toBe('local');
    expect(resolveTarget('./repo').kind).toBe('local');
    expect(resolveTarget('/abs/path').kind).toBe('local');
  });

  it('classifies org/repo shorthand as a GitHub remote', () => {
    const t = resolveTarget('octocat/hello-world');
    expect(t.kind).toBe('remote');
    expect(t.cloneUrl).toBe('https://github.com/octocat/hello-world.git');
    expect(t.url).toBe('https://github.com/octocat/hello-world');
  });

  it('classifies https and ssh URLs', () => {
    expect(resolveTarget('https://gitlab.com/g/r.git').kind).toBe('remote');
    const ssh = resolveTarget('git@github.com:org/repo.git');
    expect(ssh.kind).toBe('remote');
    expect(ssh.url).toBe('https://github.com/org/repo');
  });
});

describe('resolveWithin (zip-slip / traversal guard, PRD §12)', () => {
  it('allows paths inside the workspace', () => {
    expect(() => resolveWithin('/work', 'sub/file.json')).not.toThrow();
  });

  it('rejects parent-directory escapes', () => {
    expect(() => resolveWithin('/work', '../etc/passwd')).toThrow(IngestError);
    expect(() => resolveWithin('/work', 'a/../../b')).toThrow(IngestError);
  });

  it('rejects absolute escapes', () => {
    expect(() => resolveWithin('/work', '/etc/passwd')).toThrow(IngestError);
  });
});

describe('discoverManifests', () => {
  it('finds lockfiles across fixture projects', async () => {
    const manifests = await discoverManifests(fixturesRoot);
    const names = manifests.map((m) => m.relPath).sort();
    expect(names).toContain('npm-project/package-lock.json');
    expect(names).toContain('pnpm-project/pnpm-lock.yaml');
    expect(names).toContain('yarn-project/yarn.lock');
  });

  it('scopes discovery to a subdir', async () => {
    const manifests = await discoverManifests(fixturesRoot, { subdir: 'npm-project' });
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.kind).toBe('npm-lock');
  });
});
