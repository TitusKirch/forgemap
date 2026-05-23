import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import consola from 'consola';

const { hasCommandMock, execCaptureMock } = vi.hoisted(() => ({
  hasCommandMock: vi.fn(),
  execCaptureMock: vi.fn()
}));

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: hasCommandMock,
  execCapture: execCaptureMock,
  execInherit: vi.fn()
}));

import { cleanupCommand } from '../src/commands/cleanup.ts';

const DAY = 86_400;

interface RepoState {
  isRepo: boolean;
  origin?: string;
  dirty?: boolean;
  unpushed?: boolean;
  ageDays?: number; // last commit this many days ago
  lsRemote?: 'ok' | 'gone'; // git-forge ls-remote outcome
}

let repos: Record<string, RepoState> = {};
let remoteExists: Record<string, boolean> = {};

function ok(stdout: string) {
  return { code: 0, stdout: `${stdout}\n`, stderr: '' };
}
function fail(stderr = '') {
  return { code: 1, stdout: '', stderr };
}

async function runCleanup(
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
    await cleanupCommand.run!({
      args: {
        config: join(dir, 'forgemap.config.ts'),
        days: '365',
        'dry-run': false,
        yes: false,
        'no-cache': true,
        _: [],
        ...extra
      },
      rawArgs: [],
      cmd: cleanupCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return { out: writes.join(''), exit: process.exitCode };
}

const CONFIG = `export default {
  root: '.',
  defaultForge: 'gh',
  forges: {
    gh: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'git', host: 'git.example.com', dir: 'comGit' }
  }
};
`;

describe('cleanupCommand', () => {
  let dir: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-cleanup-'));
    cacheDir = await mkdtemp(join(tmpdir(), 'forgemap-cleanup-cache-'));
    process.env.XDG_CACHE_HOME = cacheDir;
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG, 'utf8');
    repos = {};
    remoteExists = {};
    hasCommandMock.mockReset();
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockReset();
    execCaptureMock.mockImplementation(
      async (cmd: string, args: string[], opts?: { cwd?: string }) => {
        const cwd = opts?.cwd ?? '';
        const s = repos[cwd];
        if (cmd === 'git') {
          if (args[0] === 'rev-parse') return s?.isRepo ? ok('true') : fail();
          if (args[0] === 'remote' && args[1] === 'get-url') {
            return s?.origin ? ok(s.origin) : fail();
          }
          if (args[0] === 'branch') return ok('main');
          if (args[0] === 'status') return ok(s?.dirty ? 'M file' : '');
          if (args[0] === 'rev-list') return ok('0\t0');
          if (args[0] === 'log' && args.includes('--not')) {
            // hasUnpushedCommits
            return ok(s?.unpushed ? 'deadbeef' : '');
          }
          if (args[0] === 'log' && args.includes('--branches')) {
            // getLastCommitUnix
            const ts = Math.floor(Date.now() / 1000) - (s?.ageDays ?? 0) * DAY;
            return ok(String(ts));
          }
          if (args[0] === 'log') return ok('abc123|2 years ago');
          if (args[0] === 'ls-remote') {
            // Runs without a cwd; match the repo by its origin URL.
            const match = Object.values(repos).find(
              (r) => r.origin === args[1]
            );
            return match?.lsRemote === 'gone'
              ? fail('ERROR: Repository not found')
              : ok('');
          }
        }
        if (cmd === 'gh' && args[0] === 'api' && args[1] === 'graphql') {
          const query = String(args[3] ?? '');
          const data: Record<string, { nameWithOwner: string } | null> = {};
          const re = /r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g;
          for (let m = re.exec(query); m; m = re.exec(query)) {
            const slug = `${m[2]}/${m[3]}`;
            data[`r${m[1]}`] = remoteExists[slug]
              ? { nameWithOwner: slug }
              : null;
          }
          return ok(JSON.stringify({ data }));
        }
        if (cmd === 'gh' && args[0] === 'api') {
          const slug = String(args[1]).replace('repos/', '');
          return remoteExists[slug] ? ok(slug) : fail('404 Not Found');
        }
        return ok('');
      }
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    delete process.env.XDG_CACHE_HOME;
    process.exitCode = undefined;
  });

  async function makeRepo(owner: string, repo: string, state: RepoState) {
    const local = join(dir, 'comGithub', owner, repo);
    await mkdir(local, { recursive: true });
    repos[local] = state;
    if (state.origin) {
      remoteExists[`${owner}/${repo}`] = true; // default: exists
    }
    return local;
  }

  // A repo under the `work` (type: 'git') forge — remote checked via ls-remote.
  async function makeGitRepo(owner: string, repo: string, state: RepoState) {
    const local = join(dir, 'comGit', owner, repo);
    await mkdir(local, { recursive: true });
    repos[local] = state;
    return local;
  }

  it('rejects an invalid --days', async () => {
    const { exit } = await runCleanup(dir, { days: 'abc' });
    expect(exit).toBe(1);
  });

  it('deletes a stale, clean, pushed repo whose remote exists (with --yes)', async () => {
    const local = await makeRepo('foo', 'old', {
      isRepo: true,
      origin: 'git@github.com:foo/old.git',
      ageDays: 400
    });
    const { out } = await runCleanup(dir, { yes: true });
    expect(out).toContain('foo/old');
    expect(existsSync(local)).toBe(false);
    // The now-empty owner directory is pruned too.
    expect(existsSync(join(dir, 'comGithub', 'foo'))).toBe(false);
  });

  it('keeps a recently-updated repo', async () => {
    const local = await makeRepo('foo', 'fresh', {
      isRepo: true,
      origin: 'git@github.com:foo/fresh.git',
      ageDays: 10
    });
    await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(true);
  });

  it('keeps a dirty repo', async () => {
    const local = await makeRepo('foo', 'dirty', {
      isRepo: true,
      origin: 'git@github.com:foo/dirty.git',
      ageDays: 400,
      dirty: true
    });
    const { out } = await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(true);
    // Explains why the idle repo was kept.
    expect(out).toContain('uncommitted changes');
  });

  it('keeps a repo with unpushed commits', async () => {
    const local = await makeRepo('foo', 'unpushed', {
      isRepo: true,
      origin: 'git@github.com:foo/unpushed.git',
      ageDays: 400,
      unpushed: true
    });
    await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(true);
  });

  it('--include-dirty deletes a dirty (but pushed) repo with an existing remote', async () => {
    const local = await makeRepo('foo', 'dirtyold', {
      isRepo: true,
      origin: 'git@github.com:foo/dirtyold.git',
      ageDays: 400,
      dirty: true
    });
    await runCleanup(dir, { yes: true, 'include-dirty': true });
    expect(existsSync(local)).toBe(false);
  });

  it('--include-dirty still keeps a repo that also has unpushed commits', async () => {
    const local = await makeRepo('foo', 'both', {
      isRepo: true,
      origin: 'git@github.com:foo/both.git',
      ageDays: 400,
      dirty: true,
      unpushed: true
    });
    const { out } = await runCleanup(dir, { yes: true, 'include-dirty': true });
    expect(existsSync(local)).toBe(true);
    expect(out).toContain('unpushed commits');
  });

  it('--include-dirty + --include-unpushed deletes a dirty, unpushed repo', async () => {
    const local = await makeRepo('foo', 'both2', {
      isRepo: true,
      origin: 'git@github.com:foo/both2.git',
      ageDays: 400,
      dirty: true,
      unpushed: true
    });
    await runCleanup(dir, {
      yes: true,
      'include-dirty': true,
      'include-unpushed': true
    });
    expect(existsSync(local)).toBe(false);
  });

  it('never deletes a gone remote even with both --include flags', async () => {
    const local = await makeRepo('foo', 'goneflags', {
      isRepo: true,
      origin: 'git@github.com:foo/goneflags.git',
      ageDays: 400,
      dirty: true
    });
    remoteExists['foo/goneflags'] = false;
    await runCleanup(dir, {
      yes: true,
      'include-dirty': true,
      'include-unpushed': true
    });
    expect(existsSync(local)).toBe(true);
  });

  it('removes a pre-existing empty owner directory', async () => {
    const empty = join(dir, 'comGithub', 'ghost-owner');
    await mkdir(empty, { recursive: true });
    await runCleanup(dir, { yes: true });
    expect(existsSync(empty)).toBe(false);
  });

  it('lists but keeps empty dirs in --dry-run', async () => {
    const empty = join(dir, 'comGithub', 'ghost-owner');
    await mkdir(empty, { recursive: true });
    const { out } = await runCleanup(dir, { 'dry-run': true });
    expect(out).toContain('ghost-owner');
    expect(existsSync(empty)).toBe(true);
  });

  it('ignores a repo without an origin', async () => {
    const local = await makeRepo('foo', 'noremote', {
      isRepo: true,
      ageDays: 400
    });
    await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(true);
  });

  it('never deletes when the remote no longer exists', async () => {
    const local = await makeRepo('foo', 'gone', {
      isRepo: true,
      origin: 'git@github.com:foo/gone.git',
      ageDays: 400
    });
    remoteExists['foo/gone'] = false; // remote is gone
    const { out } = await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(true);
    expect(out).toContain('remote no longer exists');
  });

  it('lists but does not delete with --dry-run', async () => {
    const local = await makeRepo('foo', 'old', {
      isRepo: true,
      origin: 'git@github.com:foo/old.git',
      ageDays: 400
    });
    const { out } = await runCleanup(dir, { 'dry-run': true });
    expect(out).toContain('foo/old');
    expect(existsSync(local)).toBe(true);
  });

  it('checks a git-type forge via ls-remote', async () => {
    const local = await makeGitRepo('team', 'api', {
      isRepo: true,
      origin: 'git@git.example.com:team/api.git',
      ageDays: 400
    });
    await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(false);
  });

  it('keeps a git repo whose remote is gone (ls-remote fails)', async () => {
    const local = await makeGitRepo('team', 'dead', {
      isRepo: true,
      origin: 'git@git.example.com:team/dead.git',
      ageDays: 400,
      lsRemote: 'gone'
    });
    const { out } = await runCleanup(dir, { yes: true });
    expect(existsSync(local)).toBe(true);
    expect(out).toContain('remote no longer exists');
  });

  it('deletes after a typed "yes" at the interactive prompt', async () => {
    const local = await makeRepo('foo', 'old', {
      isRepo: true,
      origin: 'git@github.com:foo/old.git',
      ageDays: 400
    });
    const spy = vi.spyOn(consola, 'prompt').mockResolvedValue('yes');
    try {
      await runCleanup(dir, { yes: false });
      expect(existsSync(local)).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });

  it('aborts (keeps repos) when the prompt is not "yes"', async () => {
    const local = await makeRepo('foo', 'old', {
      isRepo: true,
      origin: 'git@github.com:foo/old.git',
      ageDays: 400
    });
    const spy = vi.spyOn(consola, 'prompt').mockResolvedValue('no');
    try {
      await runCleanup(dir, { yes: false });
      expect(existsSync(local)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
