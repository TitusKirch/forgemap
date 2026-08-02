import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import { scanLayout, scanRepos } from '../src/repos/scan.ts';

function makeConfig(overrides: Partial<ForgeMapConfig> = {}): ForgeMapConfig {
  return {
    root: '.',
    defaultForge: 'github',
    forges: {
      github: { type: 'github', host: 'github.com', dir: 'comGithub' },
      work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
    },
    ...overrides
  };
}

describe('scanRepos', () => {
  let dir: string;

  /** Create a repo at `segments` below the root, marked by a `.git` directory. */
  async function repo(...segments: string[]): Promise<string> {
    const path = join(dir, ...segments);
    await mkdir(join(path, '.git'), { recursive: true });
    return path;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-scan-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when no forge directories exist', async () => {
    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toEqual([]);
  });

  it('lists repos under every configured forge', async () => {
    await repo('comGithub', 'TitusKirch', 'forgemap');
    await repo('comGithub', 'kirchDev', 'laravel-pbac');
    await repo('comGitlabAcme', 'team', 'api');

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toHaveLength(3);

    const slugs = r.map((x) => `${x.forgeName}:${x.slug}`).sort();
    expect(slugs).toEqual([
      'github:TitusKirch/forgemap',
      'github:kirchDev/laravel-pbac',
      'work:team/api'
    ]);
  });

  it('finds a repo under a nested namespace', async () => {
    await repo('comGitlabAcme', 'group', 'sub', 'deeper', 'api');

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toHaveLength(1);
    expect(r[0]!.owner).toBe('group/sub/deeper');
    expect(r[0]!.repo).toBe('api');
    expect(r[0]!.slug).toBe('group/sub/deeper/api');
  });

  it('treats a `.git` file as a repo marker, not just a directory', async () => {
    const path = join(dir, 'comGithub', 'foo', 'worktree');
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, '.git'),
      'gitdir: /elsewhere/.git/worktrees/w\n'
    );

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r.map((x) => x.slug)).toEqual(['foo/worktree']);
  });

  it('never descends into a repo, so submodules stay out', async () => {
    await repo('comGithub', 'foo', 'bar');
    await repo('comGithub', 'foo', 'bar', 'vendor', 'submodule');

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r.map((x) => x.slug)).toEqual(['foo/bar']);
  });

  it('drops branches that never reach a repo', async () => {
    await repo('comGithub', 'foo', 'bar');
    await mkdir(join(dir, 'comGithub', 'empty', 'nothing-here'), {
      recursive: true
    });

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r.map((x) => x.slug)).toEqual(['foo/bar']);
  });

  it('stops at the depth cap instead of walking a stray tree', async () => {
    const deep = Array.from({ length: 12 }, (_, i) => `n${i}`);
    await repo('comGithub', ...deep, 'buried');

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toEqual([]);
  });

  it('ignores dotfile directories', async () => {
    await mkdir(join(dir, 'comGithub', '.cache', 'something'), {
      recursive: true
    });
    await repo('comGithub', 'foo', 'real-repo');

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toHaveLength(1);
    expect(r[0]!.slug).toBe('foo/real-repo');
  });

  it('attaches the local absolute path', async () => {
    const path = await repo('comGithub', 'foo', 'bar');
    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r[0]!.localPath).toBe(path);
  });
});

describe('scanLayout hints', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-hints-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports a branch that holds no repo', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'not-a-repo'), {
      recursive: true
    });

    const { repos, hints } = await scanLayout({
      config: makeConfig(),
      configDir: dir
    });
    expect(repos).toEqual([]);
    expect(hints).toEqual([
      { path: join(dir, 'comGithub', 'foo', 'not-a-repo'), reason: 'no-repo' }
    ]);
  });

  it('reports a repo sitting directly under the forge dir', async () => {
    await mkdir(join(dir, 'comGithub', 'stray', '.git'), { recursive: true });

    const { repos, hints } = await scanLayout({
      config: makeConfig(),
      configDir: dir
    });
    expect(repos).toEqual([]);
    expect(hints).toEqual([
      { path: join(dir, 'comGithub', 'stray'), reason: 'missing-namespace' }
    ]);
  });

  it('reports the branch that hit the depth cap', async () => {
    const deep = Array.from({ length: 12 }, (_, i) => `n${i}`);
    await mkdir(join(dir, 'comGithub', ...deep), { recursive: true });

    const { hints } = await scanLayout({
      config: makeConfig(),
      configDir: dir
    });
    expect(hints.map((h) => h.reason)).toEqual(['too-deep']);
  });

  it('has nothing to report for a clean layout', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'bar', '.git'), {
      recursive: true
    });

    const { repos, hints } = await scanLayout({
      config: makeConfig(),
      configDir: dir
    });
    expect(repos).toHaveLength(1);
    expect(hints).toEqual([]);
  });
});
