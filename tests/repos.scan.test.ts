import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import { scanRepos } from '../src/repos/scan.ts';

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
    await mkdir(join(dir, 'comGithub', 'TitusKirch', 'forgemap'), {
      recursive: true
    });
    await mkdir(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'), {
      recursive: true
    });
    await mkdir(join(dir, 'comGitlabAcme', 'team', 'api'), { recursive: true });

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toHaveLength(3);

    const slugs = r.map((x) => `${x.forgeName}:${x.slug}`).sort();
    expect(slugs).toEqual([
      'github:TitusKirch/forgemap',
      'github:kirchDev/laravel-pbac',
      'work:team/api'
    ]);
  });

  it('ignores dotfile directories', async () => {
    await mkdir(join(dir, 'comGithub', '.cache', 'something'), {
      recursive: true
    });
    await mkdir(join(dir, 'comGithub', 'foo', '.git'), { recursive: true });
    await mkdir(join(dir, 'comGithub', 'foo', 'real-repo'), {
      recursive: true
    });

    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r).toHaveLength(1);
    expect(r[0]!.slug).toBe('foo/real-repo');
  });

  it('attaches the local absolute path', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const r = await scanRepos({ config: makeConfig(), configDir: dir });
    expect(r[0]!.localPath).toBe(join(dir, 'comGithub', 'foo', 'bar'));
  });
});
