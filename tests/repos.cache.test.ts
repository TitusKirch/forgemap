import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeConfig, ForgeMapConfig } from '../src/config/schema.ts';
import {
  __test,
  appendCachedRepo,
  removeCachedRepo,
  scanReposCached
} from '../src/repos/cache.ts';
import type { ScannedRepo } from '../src/repos/scan.ts';

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
  let originalTtl: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-cache-dir-'));
    cacheHome = await mkdtemp(join(tmpdir(), 'forgemap-cache-home-'));
    originalXdg = process.env.XDG_CACHE_HOME;
    originalTtl = process.env.FORGEMAP_CACHE_TTL_MS;
    process.env.XDG_CACHE_HOME = cacheHome;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheHome, { recursive: true, force: true });
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
    if (originalTtl === undefined) delete process.env.FORGEMAP_CACHE_TTL_MS;
    else process.env.FORGEMAP_CACHE_TTL_MS = originalTtl;
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

  it('serves the TTL fast path even when the layout changed', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const first = await scanReposCached({ config, configDir: dir });
    expect(first).toHaveLength(1);

    // Layout changes under us, but TTL is still hot → cache wins.
    await mkdir(join(dir, 'comGithub', 'baz', 'qux'), { recursive: true });
    const second = await scanReposCached({ config, configDir: dir });
    expect(second).toHaveLength(1);
  });

  it('invalidates when fingerprint check is forced (trustTtl=false)', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const first = await scanReposCached({
      config,
      configDir: dir,
      trustTtl: false
    });
    expect(first).toHaveLength(1);

    await mkdir(join(dir, 'comGithub', 'baz', 'qux'), { recursive: true });
    const second = await scanReposCached({
      config,
      configDir: dir,
      trustTtl: false
    });
    expect(second).toHaveLength(2);
  });

  it('invalidates when TTL is set to zero (and layout changed)', async () => {
    process.env.FORGEMAP_CACHE_TTL_MS = '0';
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
    const fresh = await scanReposCached({
      config,
      configDir: dir,
      useCache: false
    });
    expect(fresh).toHaveLength(1);
  });
});

describe('appendCachedRepo', () => {
  let dir: string;
  let cacheHome: string;
  let originalXdg: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-cache-append-dir-'));
    cacheHome = await mkdtemp(join(tmpdir(), 'forgemap-cache-append-home-'));
    originalXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cacheHome;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheHome, { recursive: true, force: true });
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
  });

  function makeRepo(owner: string, repo: string): ScannedRepo {
    const forge: ForgeConfig = {
      type: 'github',
      host: 'github.com',
      dir: 'comGithub'
    };
    return {
      forgeName: 'github',
      forge,
      owner,
      repo,
      localPath: join(dir, 'comGithub', owner, repo),
      slug: `${owner}/${repo}`
    };
  }

  it('extends the cached list without forcing a rescan', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const initial = await scanReposCached({ config, configDir: dir });
    expect(initial).toHaveLength(1);

    await mkdir(join(dir, 'comGithub', 'foo', 'baz'), { recursive: true });
    await appendCachedRepo({ config, configDir: dir }, makeRepo('foo', 'baz'));

    // TTL is hot — the next read still hits cache but now sees both entries.
    const after = await scanReposCached({ config, configDir: dir });
    expect(after.map((r) => r.slug).sort()).toEqual(['foo/bar', 'foo/baz']);
  });

  it('is a no-op when the cache file does not exist yet', async () => {
    const config = makeConfig();
    await appendCachedRepo({ config, configDir: dir }, makeRepo('foo', 'bar'));
    const after = await scanReposCached({ config, configDir: dir });
    expect(after).toEqual([]);
  });

  it('skips duplicates', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    await scanReposCached({ config, configDir: dir });
    const repo = makeRepo('foo', 'bar');
    await appendCachedRepo({ config, configDir: dir }, repo);
    await appendCachedRepo({ config, configDir: dir }, repo);
    const after = await scanReposCached({ config, configDir: dir });
    expect(after).toHaveLength(1);
  });
});

describe('removeCachedRepo', () => {
  let dir: string;
  let cacheHome: string;
  let originalXdg: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-cache-rm-dir-'));
    cacheHome = await mkdtemp(join(tmpdir(), 'forgemap-cache-rm-home-'));
    originalXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cacheHome;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheHome, { recursive: true, force: true });
    if (originalXdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalXdg;
  });

  it('drops the matching entry from the cache', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    await mkdir(join(dir, 'comGithub', 'foo', 'baz'), { recursive: true });
    await scanReposCached({ config, configDir: dir });

    await removeCachedRepo(
      { config, configDir: dir },
      join(dir, 'comGithub', 'foo', 'bar')
    );

    const after = await scanReposCached({ config, configDir: dir });
    expect(after.map((r) => r.slug)).toEqual(['foo/baz']);
  });

  it('is a no-op for an unknown path', async () => {
    const config = makeConfig();
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    await scanReposCached({ config, configDir: dir });
    await removeCachedRepo({ config, configDir: dir }, '/does/not/exist');
    const after = await scanReposCached({ config, configDir: dir });
    expect(after).toHaveLength(1);
  });
});
