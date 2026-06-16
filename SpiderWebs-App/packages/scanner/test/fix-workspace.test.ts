import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTarget } from '../src/ingest.js';
import {
  WORKSPACE_DIR,
  fixWorkspaceRoot,
  fixWorkspaceSlug,
  prepareFixWorkspace,
  type Cloner,
} from '../src/fix/workspace.js';

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );

describe('fixWorkspaceSlug', () => {
  it.each([
    ['https://github.com/acme/widgets', 'acme-widgets'],
    ['git@github.com:acme/Widgets.git', 'acme-widgets'],
    ['acme/widgets', 'acme-widgets'],
    ['/home/user/projects/my-app', 'projects-my-app'],
  ])('%s -> %s', (target, slug) => {
    expect(fixWorkspaceSlug(resolveTarget(target))).toBe(slug);
  });
});

describe('fixWorkspaceRoot', () => {
  it('nests under the workspace dir', () => {
    expect(fixWorkspaceRoot('/cwd', 'acme-widgets')).toBe(`/cwd/${WORKSPACE_DIR}/acme-widgets`);
  });
});

describe('prepareFixWorkspace', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'sw-ws-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // A fake clone that materializes a minimal git repo with one file.
  const fakeClone: Cloner = async ({ dir }) => {
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{"name":"demo"}\n');
  };

  it('clones into ./.spiderwebs-workspace/<slug> and gitignores the workspace', async () => {
    const target = resolveTarget('acme/widgets');
    const ws = await prepareFixWorkspace(target, { cwd, cloner: fakeClone });

    expect(ws.slug).toBe('acme-widgets');
    expect(ws.root).toBe(join(cwd, WORKSPACE_DIR, 'acme-widgets'));
    expect(ws.reused).toBe(false);
    expect(await exists(join(ws.root, 'package.json'))).toBe(true);
    expect(await readFile(join(cwd, WORKSPACE_DIR, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('reuses an existing clone on a second call', async () => {
    const target = resolveTarget('acme/widgets');
    await prepareFixWorkspace(target, { cwd, cloner: fakeClone });
    let cloned = false;
    const ws2 = await prepareFixWorkspace(target, {
      cwd,
      cloner: async (args) => {
        cloned = true;
        return fakeClone(args);
      },
    });
    expect(ws2.reused).toBe(true);
    expect(cloned).toBe(false); // did not re-clone
  });

  it('cleanup removes the clone (but keeps it with keep=true)', async () => {
    const target = resolveTarget('acme/widgets');
    const ws = await prepareFixWorkspace(target, { cwd, cloner: fakeClone });
    await ws.cleanup();
    expect(await exists(ws.root)).toBe(false);

    const kept = await prepareFixWorkspace(target, { cwd, keep: true, cloner: fakeClone });
    await kept.cleanup();
    expect(await exists(kept.root)).toBe(true);
  });

  it('refuses to clone a remote target in offline mode with no existing clone', async () => {
    const target = resolveTarget('acme/widgets');
    await expect(
      prepareFixWorkspace(target, { cwd, offline: true, cloner: fakeClone }),
    ).rejects.toThrow(/offline/);
  });
});
