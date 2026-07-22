import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import consola from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './helpers/citty.ts';

const { getRepoStatusMock } = vi.hoisted(() => ({
  getRepoStatusMock: vi.fn()
}));

vi.mock('../src/repos/git.ts', () => ({
  getRepoStatus: getRepoStatusMock,
  fetchRepo: vi.fn(),
  pullRepo: vi.fn(),
  isClean: vi.fn()
}));

import { statusCommand } from '../src/commands/status.ts';
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
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-status-'));
  await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  await mkdir(join(dir, 'comGithub', 'foo', 'a'), { recursive: true });
  await mkdir(join(dir, 'comGitlabAcme', 'team', 'api'), { recursive: true });
  return dir;
}

async function runStatus(
  dir: string,
  extra: Record<string, unknown> = {}
): Promise<{ out: string; exit: number | undefined }> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    await statusCommand.run!({
      args: {
        config: join(dir, 'forgemap.config.ts'),
        cache: false,
        format: 'pretty',
        ...extra,
        _: []
      },
      rawArgs: [],
      cmd: statusCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return { out: writes.join(''), exit: process.exitCode };
}

/**
 * Drives the command through citty's real argv parsing, unlike `runStatus`
 * which injects `args` directly. Repeated and negated flags only behave
 * correctly on this path, so those tests have to go through it.
 */
async function runStatusArgv(dir: string, extra: string[]): Promise<string> {
  const { out } = await runCli(statusCommand, [
    '--config',
    join(dir, 'forgemap.config.ts'),
    '--no-cache',
    ...extra
  ]);
  return out;
}

describe('statusCommand', () => {
  let dir: string;
  let cacheDir: string;
  let originalCacheHome: string | undefined;

  beforeEach(async () => {
    dir = await setup();
    // Keep the scan cache inside the fixture — the real ~/.cache/forgemap is
    // the user's, and `--no-cache` runs below would otherwise write into it.
    cacheDir = await mkdtemp(join(tmpdir(), 'forgemap-status-cache-'));
    originalCacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cacheDir;
    getRepoStatusMock.mockReset();
    getRepoStatusMock.mockResolvedValue({
      branch: 'main',
      detached: false,
      dirty: false,
      ahead: 0,
      behind: 0,
      stashes: 0,
      lastCommit: { sha: 'abc1234', relativeDate: '2 days ago' }
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalCacheHome;
    process.exitCode = undefined;
  });

  it('prints a tree of all repos in pretty mode', async () => {
    const { out, exit } = await runStatus(dir);
    expect(exit).toBeUndefined();
    expect(out).toContain('github');
    // Grouped forge → owner → repo, so owner and repo appear on separate lines.
    expect(out).toContain('foo');
    expect(out).toContain('team');
    expect(out).toContain('api');
    expect(out).toContain('abc1234');
  });

  it('renders dirty/ahead/behind markers for non-clean repos', async () => {
    getRepoStatusMock.mockResolvedValue({
      branch: 'feature',
      detached: false,
      dirty: true,
      ahead: 3,
      behind: 1,
      stashes: 0,
      lastCommit: { sha: 'def5678', relativeDate: '5 min ago' }
    });
    const { out } = await runStatus(dir);
    expect(out).toContain('↑3');
    expect(out).toContain('↓1');
    expect(out).toContain('feature');
  });

  // Issue #52: stashed work is invisible to every other marker, so `status`
  // has to say so — before `cleanup` gets a chance to delete it.
  it('surfaces the stash count, and omits the marker without stashes', async () => {
    const clean = await runStatus(dir);
    expect(clean.out).not.toContain('⚑');

    getRepoStatusMock.mockResolvedValue({
      branch: 'main',
      detached: false,
      dirty: false,
      ahead: 0,
      behind: 0,
      stashes: 2,
      lastCommit: { sha: 'abc1234', relativeDate: '2 days ago' }
    });
    const { out } = await runStatus(dir);
    expect(out).toContain('⚑2');
  });

  it('--format json includes the stash count', async () => {
    getRepoStatusMock.mockResolvedValue({
      branch: 'main',
      detached: false,
      dirty: false,
      ahead: 0,
      behind: 0,
      stashes: 4,
      lastCommit: { sha: 'abc1234', relativeDate: '2 days ago' }
    });
    const { out } = await runStatus(dir, { format: 'json' });
    expect(JSON.parse(out)[0].status.stashes).toBe(4);
  });

  it('--format json emits a structured payload', async () => {
    const { out } = await runStatus(dir, { format: 'json' });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].status.branch).toBe('main');
    expect(parsed[0].forge).toBeDefined();
  });

  it('--forge restricts the output', async () => {
    const { out } = await runStatus(dir, { forge: 'work' });
    expect(out).toContain('team');
    expect(out).toContain('api');
    expect(out).not.toContain('foo');
  });

  it('--filter restricts the output to a matching owner', async () => {
    const { out } = await runStatus(dir, { filter: 'team' });
    expect(out).toContain('api');
    expect(out).not.toContain('foo');
  });

  it('--filter is OR-combined when repeated', async () => {
    const { out } = await runStatus(dir, {
      format: 'json',
      filter: ['foo', 'team']
    });
    expect(
      JSON.parse(out)
        .map((r: { owner: string }) => r.owner)
        .sort()
    ).toEqual(['foo', 'team']);
  });

  it('--filter narrows the --format json payload', async () => {
    const { out } = await runStatus(dir, { format: 'json', filter: 'foo' });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].owner).toBe('foo');
  });

  it('--filter also matches a forge name', async () => {
    const { out } = await runStatus(dir, { format: 'json', filter: 'work' });
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].forge).toBe('work');
  });

  it('OR-combines a repeated --filter through real argv parsing', async () => {
    const out = await runStatusArgv(dir, [
      '--format',
      'json',
      '--filter',
      'foo',
      '--filter',
      'team'
    ]);
    expect(
      JSON.parse(out)
        .map((r: { owner: string }) => r.owner)
        .sort()
    ).toEqual(['foo', 'team']);
  });

  it('applies a single --filter through real argv parsing', async () => {
    const out = await runStatusArgv(dir, [
      '--format',
      'json',
      '--filter',
      'team'
    ]);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].owner).toBe('team');
  });

  it('exits 1 for invalid --format', async () => {
    const { exit } = await runStatus(dir, { format: 'csv' });
    expect(exit).toBe(1);
  });

  // Issue #59: `--no-cache` was declared as an option literally named
  // `no-cache`, but citty strips the `--no-` prefix and negates a `cache`
  // flag instead — so `args['no-cache']` never became true and the flag was
  // dead. Seeding a repo that exists only in the cache is the way to tell the
  // two paths apart: with the cache honoured it shows up, with `--no-cache`
  // the scan of the real fixture replaces it.
  describe('--no-cache through real argv parsing', () => {
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

    it('serves the cached repos when the cache is left on', async () => {
      await seedCache();
      const { out } = await runCli(statusCommand, [
        '--config',
        join(dir, 'forgemap.config.ts'),
        '--format',
        'json'
      ]);
      expect(JSON.parse(out).map((r: { owner: string }) => r.owner)).toEqual([
        'ghost'
      ]);
    });

    it('rescans and ignores the cache when --no-cache is passed', async () => {
      await seedCache();
      const { out } = await runCli(statusCommand, [
        '--config',
        join(dir, 'forgemap.config.ts'),
        '--format',
        'json',
        '--no-cache'
      ]);
      const owners = JSON.parse(out).map((r: { owner: string }) => r.owner);
      expect(owners).not.toContain('ghost');
      expect(owners.sort()).toEqual(['foo', 'team']);
    });
  });
  describe('row rendering and empty results', () => {
    it('reports a repo whose status could not be read', async () => {
      getRepoStatusMock.mockRejectedValue(new Error('not a git repo'));
      const { out } = await runStatus(dir);
      expect(out).toContain('error: not a git repo');
    });

    it('omits the commit column when there is no last commit', async () => {
      getRepoStatusMock.mockResolvedValue({
        branch: 'main',
        detached: false,
        dirty: false,
        ahead: 0,
        behind: 0,
        stashes: 0,
        lastCommit: null
      });
      const { out } = await runStatus(dir);
      expect(out).toContain('main');
      expect(out).not.toContain('abc1234');
    });

    it('groups several repos of one owner under a single owner node', async () => {
      await mkdir(join(dir, 'comGithub', 'foo', 'b'), { recursive: true });
      const { out } = await runStatus(dir);
      const ownerLines = out
        .split('\n')
        .filter((l) => l.includes('foo') && !l.includes('error'));
      expect(out).toContain('a ');
      expect(out).toContain('b ');
      expect(ownerLines).toHaveLength(1);
    });

    it('fuzzy-filters with --query', async () => {
      const { out } = await runStatus(dir, {
        query: 'team/api',
        format: 'json'
      });
      const parsed = JSON.parse(out);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].owner).toBe('team');
    });

    it('reports an empty result set in pretty mode', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'forgemap-status-empty-'));
      await writeFile(
        join(empty, 'forgemap.config.ts'),
        FIXTURE_CONFIG,
        'utf8'
      );
      const info: string[] = [];
      const spy = vi
        .spyOn(consola, 'info')
        .mockImplementation((...a: unknown[]) => info.push(String(a[0])));
      await runStatus(empty);
      expect(info.join()).toContain('No repos to report on.');
      spy.mockRestore();
      await rm(empty, { recursive: true, force: true });
    });

    it('falls back to the cwd when no config file is discovered', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'forgemap-status-bare-'));
      await mkdir(join(bare, 'comGithub', 'foo', 'a'), { recursive: true });
      const saved = process.cwd();
      const savedXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = join(bare, 'xdg-empty');
      process.chdir(bare);
      try {
        const { out } = await runCli(statusCommand, [
          '--format',
          'json',
          '--no-cache'
        ]);
        expect(JSON.parse(out)[0].owner).toBe('foo');
      } finally {
        process.chdir(saved);
        if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = savedXdg;
        await rm(bare, { recursive: true, force: true });
      }
    });
  });
});
