import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './helpers/citty.ts';

const { fetchRepoMock, pullRepoMock, isCleanMock } = vi.hoisted(() => ({
  fetchRepoMock: vi.fn(),
  pullRepoMock: vi.fn(),
  isCleanMock: vi.fn()
}));

vi.mock('../src/repos/git.ts', () => ({
  fetchRepo: fetchRepoMock,
  pullRepo: pullRepoMock,
  isClean: isCleanMock,
  getRepoStatus: vi.fn()
}));

import { syncCommand } from '../src/commands/sync.ts';
import { __test } from '../src/repos/cache.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'git', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
  }
};
`;

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-sync-'));
  await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  await mkdir(join(dir, 'comGithub', 'foo', 'a'), { recursive: true });
  await mkdir(join(dir, 'comGithub', 'foo', 'b'), { recursive: true });
  await mkdir(join(dir, 'comGitlabAcme', 'team', 'api'), { recursive: true });
  return dir;
}

async function runSync(
  dir: string,
  extra: Record<string, unknown> = {}
): Promise<number | undefined> {
  process.exitCode = undefined;
  await syncCommand.run!({
    args: {
      config: join(dir, 'forgemap.config.ts'),
      cache: false,
      pull: false,
      sequential: false,
      ...extra,
      _: []
    },
    rawArgs: [],
    cmd: syncCommand,
    data: undefined
  } as never);
  return process.exitCode;
}

describe('syncCommand', () => {
  let dir: string;
  let cacheDir: string;
  let originalCacheHome: string | undefined;

  beforeEach(async () => {
    dir = await setup();
    // Keep the scan cache inside the fixture rather than the user's real
    // ~/.cache/forgemap.
    cacheDir = await mkdtemp(join(tmpdir(), 'forgemap-sync-cache-'));
    originalCacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cacheDir;
    fetchRepoMock.mockReset();
    pullRepoMock.mockReset();
    isCleanMock.mockReset();
    fetchRepoMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    pullRepoMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    isCleanMock.mockResolvedValue(true);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalCacheHome;
    process.exitCode = undefined;
  });

  it('fetches every repo by default', async () => {
    const exit = await runSync(dir);
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).toHaveBeenCalledTimes(3);
    expect(pullRepoMock).not.toHaveBeenCalled();
  });

  it('--pull pulls clean repos, skips dirty ones', async () => {
    isCleanMock.mockImplementation(async (p: string) => !p.includes('foo/a'));
    const exit = await runSync(dir, { pull: true });
    expect(exit).toBeUndefined();
    expect(pullRepoMock).toHaveBeenCalledTimes(2);
  });

  it('--forge restricts to a single forge', async () => {
    const exit = await runSync(dir, { forge: 'work' });
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).toHaveBeenCalledTimes(1);
    expect(fetchRepoMock.mock.calls[0]![0]).toContain('comGitlabAcme');
  });

  it('--query filters fuzzily', async () => {
    const exit = await runSync(dir, { query: 'api' });
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).toHaveBeenCalledTimes(1);
    expect(fetchRepoMock.mock.calls[0]![0]).toContain('team/api');
  });

  it('--filter restricts to a matching owner', async () => {
    const exit = await runSync(dir, { filter: 'team' });
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).toHaveBeenCalledTimes(1);
    expect(fetchRepoMock.mock.calls[0]![0]).toContain('team/api');
  });

  it('--filter is OR-combined when repeated', async () => {
    const exit = await runSync(dir, { filter: ['foo', 'team'] });
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).toHaveBeenCalledTimes(3);
  });

  it('exits 1 when any fetch fails', async () => {
    fetchRepoMock.mockImplementation(async (p: string) =>
      p.includes('foo/a')
        ? { code: 1, stdout: '', stderr: 'boom' }
        : { code: 0, stdout: '', stderr: '' }
    );
    const exit = await runSync(dir);
    expect(exit).toBe(1);
  });

  it('treats a timed-out fetch as a failure (does not hang)', async () => {
    fetchRepoMock.mockImplementation(async (p: string) =>
      p.includes('team/api')
        ? { code: 124, stdout: '', stderr: '', timedOut: true }
        : { code: 0, stdout: '', stderr: '' }
    );
    const exit = await runSync(dir);
    expect(exit).toBe(1);
  });

  it('reports a failure when fetchRepo throws', async () => {
    fetchRepoMock.mockImplementation(async () => {
      throw new Error('spawn ENOENT');
    });
    const exit = await runSync(dir);
    expect(exit).toBe(1);
  });

  it('reports nothing to sync when filters match nothing', async () => {
    const exit = await runSync(dir, { query: 'zzz-no-match-zzz' });
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).not.toHaveBeenCalled();
  });

  it('--sequential limits the worker pool to 1', async () => {
    const exit = await runSync(dir, { sequential: true });
    expect(exit).toBeUndefined();
    expect(fetchRepoMock).toHaveBeenCalledTimes(3);
  });

  // Issue #59: everything above injects `args` straight into the handler, so
  // citty never parses anything. The flags whose parsing is non-trivial —
  // a repeatable `--filter` and a negated `--no-cache` — are only honest on
  // this path, so they are asserted through real argv here.
  describe('citty argument parsing', () => {
    async function runArgv(rawArgs: string[]) {
      return runCli(syncCommand, [
        '--config',
        join(dir, 'forgemap.config.ts'),
        ...rawArgs
      ]);
    }

    /** A repo present only in the cache file, never on disk. */
    async function seedCache(): Promise<void> {
      const file = __test.cachePath(dir);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          fingerprint: 'seeded',
          writtenAt: Date.now(),
          repos: [
            {
              forgeName: 'github',
              forge: { type: 'github', host: 'github.com', dir: 'comGithub' },
              owner: 'ghost',
              repo: 'cached-only',
              localPath: join(dir, 'comGithub', 'ghost', 'cached-only'),
              slug: 'ghost/cached-only'
            }
          ]
        }),
        'utf8'
      );
    }

    it('OR-combines a repeated --filter', async () => {
      await runArgv(['--no-cache', '--filter', 'foo', '--filter', 'team']);
      expect(fetchRepoMock).toHaveBeenCalledTimes(3);
    });

    it('applies a single --filter', async () => {
      await runArgv(['--no-cache', '--filter', 'team']);
      expect(fetchRepoMock).toHaveBeenCalledTimes(1);
      expect(fetchRepoMock.mock.calls[0]![0]).toContain('team/api');
    });

    it('serves the cached repos when the cache is left on', async () => {
      await seedCache();
      await runArgv([]);
      expect(fetchRepoMock).toHaveBeenCalledTimes(1);
      expect(fetchRepoMock.mock.calls[0]![0]).toContain('ghost/cached-only');
    });

    it('rescans and ignores the cache when --no-cache is passed', async () => {
      await seedCache();
      await runArgv(['--no-cache']);
      expect(fetchRepoMock).toHaveBeenCalledTimes(3);
      const paths = fetchRepoMock.mock.calls.map((c) => c[0] as string);
      expect(paths.some((p) => p.includes('ghost'))).toBe(false);
    });
  });
});
