import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runCommand } from 'citty';
import consola from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hasCommandMock, execCaptureMock } = vi.hoisted(() => ({
  hasCommandMock: vi.fn(),
  execCaptureMock: vi.fn()
}));

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: hasCommandMock,
  execCapture: execCaptureMock,
  execInherit: vi.fn()
}));

import { deleteCommand } from '../src/commands/delete.ts';
import { __test } from '../src/repos/cache.ts';

interface RepoState {
  isRepo: boolean;
  origin?: string;
  dirty?: boolean;
  unpushed?: boolean;
  /** Local branch names reported by `for-each-ref`. */
  branches?: string[];
  /** Which of those carry commits on no remote. */
  unpushedBranches?: string[];
  /** Entries on refs/stash. */
  stashes?: number;
  lsRemote?: 'ok' | 'gone';
}

let repos: Record<string, RepoState> = {};
let remoteExists: Record<string, boolean> = {};

function ok(stdout: string) {
  return { code: 0, stdout: `${stdout}\n`, stderr: '' };
}
function fail(stderr = '') {
  return { code: 1, stdout: '', stderr };
}

/**
 * Drives the command through citty's REAL argument parsing (`runCommand` +
 * `node:util parseArgs`) rather than hand-injecting an `args` object — an
 * injected object silently bypasses parsing and would mask flags that do not
 * actually work on the command line.
 */
async function runDelete(
  dir: string,
  rawArgs: string[]
): Promise<{ out: string; exit: number | undefined }> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    await runCommand(deleteCommand, {
      rawArgs: [...rawArgs, '--config', join(dir, 'forgemap.config.ts')]
    });
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

describe('deleteCommand', () => {
  let dir: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-delete-'));
    cacheDir = await mkdtemp(join(tmpdir(), 'forgemap-delete-cache-'));
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
          if (args[0] === 'stash') {
            // countStashes: one `stash@{n}` line per entry.
            const n = s?.stashes ?? 0;
            return ok(
              Array.from({ length: n }, (_, i) => `stash@{${i}}`).join('\n')
            );
          }
          if (args[0] === 'rev-list') return ok('0\t0');
          if (args[0] === 'for-each-ref') {
            return ok((s?.branches ?? ['main']).join('\n'));
          }
          if (args[0] === 'log' && args.includes('--not')) {
            // hasUnpushedCommits (--branches) vs getUnpushedBranches (<branch>)
            if (args[1] === '--branches') return ok(s?.unpushed ? 'dead' : '');
            const branch = args[1]!;
            return ok(s?.unpushedBranches?.includes(branch) ? 'dead' : '');
          }
          if (args[0] === 'log' && args.includes('--branches')) {
            // getLastCommitUnix
            return ok(String(Math.floor(Date.now() / 1000)));
          }
          if (args[0] === 'log') return ok('abc123|2 years ago');
          if (args[0] === 'ls-remote') {
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
    if (state.origin) remoteExists[`${owner}/${repo}`] = true;
    return local;
  }

  const clean = (owner: string, repo: string): RepoState => ({
    isRepo: true,
    origin: `git@github.com:${owner}/${repo}.git`
  });

  it('deletes a clean, pushed repo whose remote exists (--yes)', async () => {
    const local = await makeRepo('foo', 'bar', clean('foo', 'bar'));
    const { out, exit } = await runDelete(dir, ['foo/bar', '--yes']);
    expect(existsSync(local)).toBe(false);
    expect(out).toContain('foo/bar');
    expect(exit).toBeUndefined();
  });

  it('deletes with no staleness requirement (a repo committed today)', async () => {
    // The whole point of `delete`: `cleanup` would never touch this repo.
    const local = await makeRepo('foo', 'fresh', clean('foo', 'fresh'));
    await runDelete(dir, ['foo/fresh', '--yes']);
    expect(existsSync(local)).toBe(false);
  });

  it('resolves a forge-qualified slug', async () => {
    const local = join(dir, 'comGit', 'team', 'api');
    await mkdir(local, { recursive: true });
    repos[local] = {
      isRepo: true,
      origin: 'git@git.example.com:team/api.git'
    };
    await runDelete(dir, ['work:team/api', '--yes']);
    expect(existsSync(local)).toBe(false);
  });

  it('prunes the emptied owner directory', async () => {
    await makeRepo('lonely', 'only', clean('lonely', 'only'));
    await runDelete(dir, ['lonely/only', '--yes']);
    expect(existsSync(join(dir, 'comGithub', 'lonely'))).toBe(false);
  });

  it('evicts the deleted repo from the scan cache', async () => {
    const local = await makeRepo('foo', 'cached', clean('foo', 'cached'));
    const file = __test.cachePath(dir);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        fingerprint: 'seed',
        writtenAt: Date.now(),
        repos: [
          {
            forgeName: 'gh',
            forge: { type: 'github', host: 'github.com', dir: 'comGithub' },
            owner: 'foo',
            repo: 'cached',
            localPath: local,
            slug: 'foo/cached'
          }
        ]
      }),
      'utf8'
    );

    await runDelete(dir, ['foo/cached', '--yes']);

    const after = JSON.parse(await readFile(file, 'utf8')) as {
      repos: unknown[];
    };
    expect(after.repos).toHaveLength(0);
  });

  describe('gates', () => {
    it('refuses a dirty repo', async () => {
      const local = await makeRepo('foo', 'dirty', {
        ...clean('foo', 'dirty'),
        dirty: true
      });
      const { exit } = await runDelete(dir, ['foo/dirty', '--yes']);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('--include-dirty overrides the dirty gate', async () => {
      const local = await makeRepo('foo', 'dirty2', {
        ...clean('foo', 'dirty2'),
        dirty: true
      });
      await runDelete(dir, ['foo/dirty2', '--yes', '--include-dirty']);
      expect(existsSync(local)).toBe(false);
    });

    it('refuses a repo with unpushed commits', async () => {
      const local = await makeRepo('foo', 'unpushed', {
        ...clean('foo', 'unpushed'),
        unpushed: true
      });
      const { exit } = await runDelete(dir, ['foo/unpushed', '--yes']);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('--include-unpushed overrides the unpushed gate', async () => {
      const local = await makeRepo('foo', 'unpushed2', {
        ...clean('foo', 'unpushed2'),
        unpushed: true
      });
      await runDelete(dir, ['foo/unpushed2', '--yes', '--include-unpushed']);
      expect(existsSync(local)).toBe(false);
    });

    // A repo whose only local work is stashed looks clean, idle and fully
    // pushed to every other gate — the bug TitusKirch/forgemap#52 fixed for
    // cleanup. delete must not reintroduce it.
    it('refuses a repo whose only local work is stashed', async () => {
      const local = await makeRepo('foo', 'stashonly', {
        ...clean('foo', 'stashonly'),
        stashes: 1
      });
      const { exit } = await runDelete(dir, ['foo/stashonly', '--yes']);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('--include-stashed overrides the stashed gate', async () => {
      const local = await makeRepo('foo', 'stashed2', {
        ...clean('foo', 'stashed2'),
        stashes: 2
      });
      await runDelete(dir, ['foo/stashed2', '--yes', '--include-stashed']);
      expect(existsSync(local)).toBe(false);
    });

    // Stashes are separate work, so the other escape hatches must not carry
    // them along.
    it('--include-dirty alone still refuses a stashed repo', async () => {
      const local = await makeRepo('foo', 'dirtystash', {
        ...clean('foo', 'dirtystash'),
        dirty: true,
        stashes: 1
      });
      const { exit } = await runDelete(dir, [
        'foo/dirtystash',
        '--yes',
        '--include-dirty'
      ]);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    // The loss report names what deletion would destroy, rather than a bare
    // "stashed work" boolean.
    it('names the stash count in the loss report', async () => {
      await makeRepo('foo', 'stashreport', {
        ...clean('foo', 'stashreport'),
        stashes: 3
      });
      const { out } = await runDelete(dir, ['foo/stashreport', '--yes']);
      expect(out).toContain('3 stashes');
    });

    it('--include-dirty alone still refuses an unpushed repo', async () => {
      const local = await makeRepo('foo', 'both', {
        ...clean('foo', 'both'),
        dirty: true,
        unpushed: true
      });
      const { exit } = await runDelete(dir, [
        'foo/both',
        '--yes',
        '--include-dirty'
      ]);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('both --include flags delete a dirty, unpushed repo', async () => {
      const local = await makeRepo('foo', 'both2', {
        ...clean('foo', 'both2'),
        dirty: true,
        unpushed: true
      });
      await runDelete(dir, [
        'foo/both2',
        '--yes',
        '--include-dirty',
        '--include-unpushed'
      ]);
      expect(existsSync(local)).toBe(false);
    });

    it('refuses when the remote is gone — never overridable', async () => {
      const local = await makeRepo('foo', 'gone', clean('foo', 'gone'));
      remoteExists['foo/gone'] = false;
      const { exit } = await runDelete(dir, [
        'foo/gone',
        '--yes',
        '--include-dirty',
        '--include-unpushed'
      ]);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('refuses when a git-forge remote is gone (ls-remote fails)', async () => {
      const local = join(dir, 'comGit', 'team', 'dead');
      await mkdir(local, { recursive: true });
      repos[local] = {
        isRepo: true,
        origin: 'git@git.example.com:team/dead.git',
        lsRemote: 'gone'
      };
      const { exit } = await runDelete(dir, ['work:team/dead', '--yes']);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('refuses a directory that is not a git repo', async () => {
      const local = join(dir, 'comGithub', 'foo', 'plain');
      await mkdir(local, { recursive: true });
      repos[local] = { isRepo: false };
      const { exit } = await runDelete(dir, ['foo/plain', '--yes']);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('refuses a repo without an origin', async () => {
      const local = await makeRepo('foo', 'noremote', { isRepo: true });
      const { exit } = await runDelete(dir, ['foo/noremote', '--yes']);
      expect(existsSync(local)).toBe(true);
      expect(exit).toBe(1);
    });

    it('errors on a repo that does not exist locally', async () => {
      const { exit } = await runDelete(dir, ['foo/ghost', '--yes']);
      expect(exit).toBe(1);
    });
  });

  describe('what would be lost', () => {
    const withBranches = () => ({
      ...clean('foo', 'work'),
      unpushed: true,
      branches: ['main', 'feature-x', 'spike'],
      unpushedBranches: ['feature-x', 'spike']
    });

    it('names the branches carrying unpushed commits when refusing', async () => {
      await makeRepo('foo', 'work', withBranches());
      const { out, exit } = await runDelete(dir, ['foo/work', '--yes']);
      expect(exit).toBe(1);
      expect(out).toContain('feature-x');
      expect(out).toContain('spike');
      // A pushed branch is not reported as at-risk work.
      expect(out).not.toContain('main,');
    });

    it('names them before actually deleting with --include-unpushed', async () => {
      const local = await makeRepo('foo', 'work', withBranches());
      const { out } = await runDelete(dir, [
        'foo/work',
        '--yes',
        '--include-unpushed'
      ]);
      expect(out).toContain('unpushed commits on feature-x, spike');
      expect(existsSync(local)).toBe(false);
    });

    it('reports uncommitted changes', async () => {
      await makeRepo('foo', 'wip', { ...clean('foo', 'wip'), dirty: true });
      const { out } = await runDelete(dir, ['foo/wip', '--yes']);
      expect(out).toContain('uncommitted changes');
    });
  });

  describe('--dry-run', () => {
    it('never deletes', async () => {
      const local = await makeRepo('foo', 'dry', clean('foo', 'dry'));
      const { out } = await runDelete(dir, ['foo/dry', '--dry-run']);
      expect(existsSync(local)).toBe(true);
      expect(out).toContain('foo/dry');
    });

    it('never prompts', async () => {
      await makeRepo('foo', 'dry2', clean('foo', 'dry2'));
      const spy = vi.spyOn(consola, 'prompt');
      try {
        await runDelete(dir, ['foo/dry2', '--dry-run']);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('confirmation', () => {
    it('deletes after the literal "yes"', async () => {
      const local = await makeRepo('foo', 'c1', clean('foo', 'c1'));
      const spy = vi.spyOn(consola, 'prompt').mockResolvedValue('yes');
      try {
        await runDelete(dir, ['foo/c1']);
        expect(existsSync(local)).toBe(false);
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    });

    it('accepts "yes" with surrounding whitespace', async () => {
      const local = await makeRepo('foo', 'c2', clean('foo', 'c2'));
      const spy = vi.spyOn(consola, 'prompt').mockResolvedValue('  yes  ');
      try {
        await runDelete(dir, ['foo/c2']);
        expect(existsSync(local)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    // Anything that is not the literal "yes" must delete nothing — notably
    // "y", which a y/N-style prompt would have accepted.
    for (const answer of [
      'no',
      'n',
      'y',
      'Y',
      'YES',
      'Yes',
      '',
      'yes please'
    ]) {
      it(`aborts on ${JSON.stringify(answer)}`, async () => {
        const local = await makeRepo('foo', 'keep', clean('foo', 'keep'));
        const spy = vi.spyOn(consola, 'prompt').mockResolvedValue(answer);
        try {
          await runDelete(dir, ['foo/keep']);
          expect(existsSync(local)).toBe(true);
        } finally {
          spy.mockRestore();
        }
      });
    }

    it('aborts when the prompt is cancelled', async () => {
      const local = await makeRepo('foo', 'cancel', clean('foo', 'cancel'));
      const spy = vi
        .spyOn(consola, 'prompt')
        .mockResolvedValue(null as unknown as string);
      try {
        await runDelete(dir, ['foo/cancel']);
        expect(existsSync(local)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('--yes is the only bypass (no prompt)', async () => {
      const local = await makeRepo('foo', 'auto', clean('foo', 'auto'));
      const spy = vi.spyOn(consola, 'prompt');
      try {
        await runDelete(dir, ['foo/auto', '--yes']);
        expect(spy).not.toHaveBeenCalled();
        expect(existsSync(local)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
