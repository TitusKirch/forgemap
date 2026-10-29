import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import consola from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './helpers/citty.ts';

const { hasCommandMock, execCaptureMock } = vi.hoisted(() => ({
  hasCommandMock: vi.fn(),
  execCaptureMock: vi.fn()
}));

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: hasCommandMock,
  execCapture: execCaptureMock,
  execInherit: vi.fn()
}));

import { moveCommand } from '../src/commands/move.ts';

/** origin per repo path — the only git state `move` reads. */
let origins: Record<string, string> = {};
/** GitHub's view: slug → canonical slug (absent = gone). */
let github: Record<string, string> = {};
let setUrlCalls: Array<{ cwd: string; url: string }> = [];

function ok(stdout: string) {
  return { code: 0, stdout: `${stdout}\n`, stderr: '' };
}
function fail(stderr = '') {
  return { code: 1, stdout: '', stderr };
}

const CONFIG = `export default {
  root: '.',
  defaultForge: 'gh',
  forges: {
    gh: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

describe('moveCommand', () => {
  let dir: string;
  let home: string;
  let cacheDir: string;

  async function run(rawArgs: string[]) {
    return runCli(moveCommand, [
      ...rawArgs,
      '--config',
      join(dir, 'forgemap.config.ts')
    ]);
  }

  async function makeRepo(owner: string, repo: string, origin: string) {
    const local = join(dir, 'comGithub', owner, repo);
    await mkdir(join(local, '.git'), { recursive: true });
    origins[local] = origin;
    return local;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-move-'));
    home = await mkdtemp(join(tmpdir(), 'forgemap-move-home-'));
    cacheDir = await mkdtemp(join(tmpdir(), 'forgemap-move-cache-'));
    // stubEnv, never a reassigned process.env: os.homedir() reads the real
    // environment, and a plain-object copy would point it at the real ~/.claude.
    vi.stubEnv('XDG_CACHE_HOME', cacheDir);
    vi.stubEnv('HOME', home);
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
    vi.stubEnv('CODEX_HOME', undefined);
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG, 'utf8');
    origins = {};
    github = {};
    setUrlCalls = [];
    hasCommandMock.mockReset();
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockReset();
    execCaptureMock.mockImplementation(
      async (cmd: string, args: string[], opts?: { cwd?: string }) => {
        const cwd = opts?.cwd ?? '';
        if (cmd === 'git' && args[0] === 'remote' && args[1] === 'get-url') {
          return origins[cwd] ? ok(origins[cwd]) : fail();
        }
        if (cmd === 'git' && args[0] === 'remote' && args[1] === 'set-url') {
          setUrlCalls.push({ cwd, url: args[3]! });
          origins[cwd] = args[3]!;
          return ok('');
        }
        if (cmd === 'gh' && args[1] === 'graphql') {
          const query = String(args[3] ?? '');
          const data: Record<string, { nameWithOwner: string } | null> = {};
          const re = /r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g;
          for (let m = re.exec(query); m; m = re.exec(query)) {
            const slug = `${m[2]}/${m[3]}`;
            // GraphQL does not follow renames: only an exact hit resolves.
            data[`r${m[1]}`] =
              github[slug] === slug ? { nameWithOwner: slug } : null;
          }
          return ok(JSON.stringify({ data }));
        }
        if (cmd === 'gh' && args[0] === 'api') {
          const slug = String(args[1]).replace('repos/', '');
          return github[slug] ? ok(github[slug]) : fail('404 Not Found');
        }
        return ok('');
      }
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    vi.restoreAllMocks();
    for (const d of [dir, home, cacheDir]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('moves a repo whose origin was repointed by hand', async () => {
    const from = await makeRepo(
      'TitusKirch',
      'mc-network',
      'git@github.com:kirch-ostendorf/sirargon-net.git'
    );
    github['kirch-ostendorf/sirargon-net'] = 'kirch-ostendorf/sirargon-net';

    const { out, exit } = await run(['TitusKirch/mc-network']);

    const to = join(dir, 'comGithub', 'kirch-ostendorf', 'sirargon-net');
    expect(existsSync(from)).toBe(false);
    expect(existsSync(join(to, '.git'))).toBe(true);
    expect(out).toContain('gh:kirch-ostendorf/sirargon-net');
    // The emptied owner folder is pruned; origin is left as the user set it.
    expect(existsSync(join(dir, 'comGithub', 'TitusKirch'))).toBe(false);
    expect(setUrlCalls).toEqual([]);
    expect(exit).toBeUndefined();
    // git worktree repair runs at the new location.
    expect(execCaptureMock).toHaveBeenCalledWith(
      'git',
      ['worktree', 'repair'],
      { cwd: to }
    );
  });

  it('follows a remote the forge reports as moved, keeping ssh', async () => {
    const from = await makeRepo('old', 'name', 'git@github.com:old/name.git');
    github['old/name'] = 'new/renamed';

    await run(['old/name']);

    const to = join(dir, 'comGithub', 'new', 'renamed');
    expect(existsSync(from)).toBe(false);
    expect(existsSync(to)).toBe(true);
    expect(setUrlCalls).toEqual([
      { cwd: from, url: 'git@github.com:new/renamed.git' }
    ]);
  });

  it('only follows the local origin with --no-remote-check', async () => {
    await makeRepo('old', 'name', 'git@github.com:old/name.git');
    github['old/name'] = 'new/renamed';

    const { out } = await run(['old/name', '--no-remote-check']);

    expect(out).toContain('already where origin points');
    expect(setUrlCalls).toEqual([]);
    expect(execCaptureMock).not.toHaveBeenCalledWith(
      'gh',
      expect.anything(),
      expect.anything()
    );
  });

  it('repoints origin in place when only the remote moved', async () => {
    // Folder already matches the new name, origin still has the old one.
    const local = await makeRepo(
      'new',
      'renamed',
      'git@github.com:old/name.git'
    );
    github['old/name'] = 'new/renamed';

    await run(['new/renamed']);

    expect(existsSync(local)).toBe(true);
    expect(setUrlCalls).toEqual([
      { cwd: local, url: 'git@github.com:new/renamed.git' }
    ]);
  });

  it('defaults to the repo the current directory is in', async () => {
    const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
    await mkdir(join(from, 'src'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(join(from, 'src'));

    await run(['--no-remote-check']);
    cwd.mockRestore();

    expect(existsSync(join(dir, 'comGithub', 'b', 'one'))).toBe(true);
  });

  it('fails outside a repo when no repo is named', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    const { exit } = await run([]);
    expect(exit).toBe(1);
    expect(error.mock.calls[0]?.[0]).toContain('Not inside a cloned repo');
  });

  it('fails when the named repo is not cloned', async () => {
    vi.spyOn(consola, 'error').mockImplementation(() => {});
    const { exit } = await run(['nope/missing']);
    expect(exit).toBe(1);
  });

  it('rejects a repo together with --all', async () => {
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    const { exit } = await run(['a/b', '--all']);
    expect(exit).toBe(1);
    expect(error.mock.calls[0]?.[0]).toContain('not both');
  });

  it('refuses to overwrite an existing target', async () => {
    const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
    await makeRepo('b', 'one', 'git@github.com:b/one.git');

    const { out, exit } = await run(['a/one', '--no-remote-check']);

    expect(existsSync(from)).toBe(true);
    expect(out).toContain('target already exists');
    expect(exit).toBe(1);
  });

  describe('linked worktrees', () => {
    async function makeWorktree(owner: string, repo: string, origin: string) {
      const local = join(dir, 'comGithub', owner, repo);
      await mkdir(local, { recursive: true });
      await writeFile(
        join(local, '.git'),
        `gitdir: ${join(dir, 'comGithub', owner, 'main', '.git', 'worktrees', repo)}\n`
      );
      origins[local] = origin;
      return local;
    }

    it('never moves a worktree, however its origin reads', async () => {
      const local = await makeWorktree(
        'a',
        'main-fix',
        'git@github.com:a/main.git'
      );
      const { out, exit } = await run(['a/main-fix', '--no-remote-check']);
      expect(existsSync(local)).toBe(true);
      expect(out).toContain('linked worktree');
      expect(exit).toBeUndefined();
    });

    it('leaves worktrees out of --all, but not a repo with a .git file', async () => {
      await makeWorktree('a', 'main-fix', 'git@github.com:a/main.git');
      // A submodule-style pointer is not a worktree and still follows origin.
      const sub = join(dir, 'comGithub', 'a', 'sub');
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, '.git'), 'gitdir: ../.git/modules/sub\n');
      origins[sub] = 'git@github.com:b/sub.git';

      const { out } = await run(['--all', '--yes', '--no-remote-check']);

      expect(out).not.toContain('main-fix');
      expect(existsSync(join(dir, 'comGithub', 'b', 'sub'))).toBe(true);
    });
  });

  it('skips a repo without origin', async () => {
    const local = join(dir, 'comGithub', 'a', 'bare');
    await mkdir(join(local, '.git'), { recursive: true });
    const { out, exit } = await run(['a/bare']);
    expect(out).toContain('no origin remote');
    expect(exit).toBe(1);
  });

  it('skips an origin on a host no forge is configured for', async () => {
    await makeRepo('a', 'x', 'git@gitlab.com:a/x.git');
    const { out } = await run(['a/x', '--no-remote-check']);
    expect(out).toContain('No forge configured for host "gitlab.com"');
  });

  it('skips a nested target the forge cannot hold', async () => {
    // A github remote resolved to a nested GitLab-style path is rejected.
    await makeRepo('a', 'x', 'git@github.com:a/b/x.git');
    const { out } = await run(['a/x', '--no-remote-check']);
    expect(out).toContain('!');
    expect(existsSync(join(dir, 'comGithub', 'a', 'x'))).toBe(true);
  });

  it('reports without moving on --dry-run', async () => {
    const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
    const { out } = await run(['a/one', '--dry-run', '--no-remote-check']);
    expect(existsSync(from)).toBe(true);
    expect(out).toContain('gh:b/one');
  });

  describe('--all', () => {
    it('moves every mismatched repo with --yes and hides the rest', async () => {
      await makeRepo('a', 'one', 'git@github.com:b/one.git');
      await makeRepo('c', 'two', 'git@github.com:c/two.git');

      const { out } = await run(['--all', '--yes', '--no-remote-check']);

      expect(existsSync(join(dir, 'comGithub', 'b', 'one'))).toBe(true);
      expect(out).not.toContain('c/two');
    });

    it('says so when there is nothing to move', async () => {
      await makeRepo('c', 'two', 'git@github.com:c/two.git');
      const info = vi.spyOn(consola, 'info').mockImplementation(() => {});
      await run(['--all', '--no-remote-check']);
      expect(info).toHaveBeenCalledWith('Nothing to move.');
    });

    it('refuses without --yes when nobody can confirm', async () => {
      const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
      vi.spyOn(consola, 'error').mockImplementation(() => {});
      const { exit } = await run(['--all', '--no-remote-check']);
      expect(existsSync(from)).toBe(true);
      expect(exit).toBe(1);
    });

    it('asks for confirmation on a TTY', async () => {
      const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
      const tty = process.stdin.isTTY;
      process.stdin.isTTY = true;
      const prompt = vi.spyOn(consola, 'prompt').mockResolvedValue(false);
      try {
        await run(['--all', '--no-remote-check']);
      } finally {
        process.stdin.isTTY = tty;
      }
      expect(prompt).toHaveBeenCalled();
      expect(existsSync(from)).toBe(true);

      prompt.mockResolvedValue(true);
      process.stdin.isTTY = true;
      try {
        await run(['--all', '--no-remote-check']);
      } finally {
        process.stdin.isTTY = tty;
      }
      expect(existsSync(from)).toBe(false);
    });
  });

  it('reports a failed origin update and keeps the repo', async () => {
    const from = await makeRepo('old', 'name', 'git@github.com:old/name.git');
    github['old/name'] = 'new/renamed';
    const base = execCaptureMock.getMockImplementation()!;
    execCaptureMock.mockImplementation(async (cmd, args, opts) =>
      cmd === 'git' && args[1] === 'set-url'
        ? fail('locked')
        : base(cmd, args, opts)
    );
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});

    const { exit } = await run(['old/name']);

    expect(existsSync(from)).toBe(true);
    expect(error.mock.calls[0]?.[0]).toContain('locked');
    expect(exit).toBe(1);
  });

  describe('--agents', () => {
    async function claudeProject(path: string) {
      const name = path.replace(/[^a-zA-Z0-9]/g, '-');
      const folder = join(home, '.claude', 'projects', name);
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, 's.jsonl'),
        `${JSON.stringify({ cwd: path })}\n`
      );
      return folder;
    }

    it('carries agent state along with the repo', async () => {
      const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
      const to = join(dir, 'comGithub', 'b', 'one');
      const folder = await claudeProject(from);

      const { out } = await run(['a/one', '--agents', '--no-remote-check']);
      expect(existsSync(folder)).toBe(false);
      expect(
        existsSync(
          join(home, '.claude', 'projects', to.replace(/[^a-zA-Z0-9]/g, '-'))
        )
      ).toBe(true);
      expect(out).toContain('claude');
    });

    it('reports agent state without touching it on --dry-run', async () => {
      const from = await makeRepo('a', 'one', 'git@github.com:b/one.git');
      const folder = await claudeProject(from);

      const { out } = await run([
        'a/one',
        '--agents',
        '--dry-run',
        '--no-remote-check'
      ]);

      expect(existsSync(folder)).toBe(true);
      expect(out).toContain('agents:');
    });

    it('says when there is no agent state', async () => {
      await makeRepo('a', 'one', 'git@github.com:b/one.git');
      const { out } = await run(['a/one', '--agents', '--no-remote-check']);
      expect(out).toContain('no agent state recorded');
    });

    it('skips agent migration when only origin changed', async () => {
      const local = await makeRepo(
        'new',
        'renamed',
        'git@github.com:old/name.git'
      );
      github['old/name'] = 'new/renamed';
      await writeFile(join(home, '.claude.json'), '{"projects":{}}\n');

      const { out } = await run(['new/renamed', '--agents']);

      expect(existsSync(local)).toBe(true);
      expect(out).not.toContain('no agent state');
      expect(await readFile(join(home, '.claude.json'), 'utf8')).toBe(
        '{"projects":{}}\n'
      );
    });
  });
});
