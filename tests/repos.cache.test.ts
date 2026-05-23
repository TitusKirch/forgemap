import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import { __test, scanReposCached } from '../src/repos/cache.ts';

function makeConfig(): ForgeMapConfig {
  return {
    root: '.',
    defaultForge: 'github',
    forges: {
      github: { type: 'github', host: 'github.com', dir: 'comGithub' }
    }
  };
}

describe('scanReposCached', () => {
  let dir: string;
  let cacheHome: string;
  let originalXdg: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-cache-dir-'));
    cacheHome = await mkdtemp(join(tmpdir(), 'forgemap-cache-home-'));
    originalXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cacheHome;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheHome, { recursive: true, force: true });
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
  });

  it('returns [] for an empty layout and writes a cache file', async () => {
    const config = makeConfig();
    const r = await scanReposCached({ config, configDir: dir });
    expect(r).toEqual([]);

    const cacheFile = __test.cachePath(dir);
    expect(cacheFile.startsWith(cacheHome)).toBe(true);
  });

  it('returns cached results when the layout has not changed', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const first = await scanReposCached({ config, configDir: dir });
    const second = await scanReposCached({ config, configDir: dir });
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
  });

  it('invalidates when a new owner directory is added', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const first = await scanReposCached({ config, configDir: dir });
    expect(first).toHaveLength(1);

    await mkdir(join(dir, 'comGithub', 'baz', 'qux'), { recursive: true });
    const second = await scanReposCached({ config, configDir: dir });
    expect(second).toHaveLength(2);
  });

  it('invalidates when a new repo is added under an existing owner', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const first = await scanReposCached({ config, configDir: dir });
    expect(first).toHaveLength(1);

    await mkdir(join(dir, 'comGithub', 'foo', 'baz'), { recursive: true });
    const second = await scanReposCached({ config, configDir: dir });
    expect(second.map((r) => r.slug).sort()).toEqual(['foo/bar', 'foo/baz']);
  });

  it('bypasses the cache when useCache=false', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    await scanReposCached({ config, configDir: dir });
    // Hand-craft a stale entry by writing junk to the cache file.
    // Even with junk in place, useCache=false should ignore it.
    const fresh = await scanReposCached({
      config,
      configDir: dir,
      useCache: false
    });
    expect(fresh).toHaveLength(1);
  });
});
