import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

import { importCommand } from '../src/commands/import.ts';

interface RepoState {
  isRepo: boolean;
  origin?: string;
  lsRemote?: 'ok' | 'gone';
}

let repos: Record<string, RepoState> = {};
let ghResponses: Record<string, string> = {};
let setUrlCalls: Array<{ cwd: string; url: string }> = [];

function ok(stdout: string) {
  return { code: 0, stdout: `${stdout}\n`, stderr: '' };
}
function fail(stderr = '') {
  return { code: 1, stdout: '', stderr };
}

interface RunArgs {
  path: string;
  type?: string;
  format?: string;
  'remote-check'?: boolean;
  fix?: boolean;
  'write-config'?: boolean;
  out?: string;
  force?: boolean;
}

async function runImport(
  args: RunArgs
): Promise<{ out: string; exit: number | undefined }> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    await importCommand.run!({
      args: {
        type: 'forgemap',
        format: 'pretty',
        'remote-check': true,
        fix: false,
        'write-config': true,
        force: false,
        ...args,
        _: []
      },
      rawArgs: [],
      cmd: importCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return { out: writes.join(''), exit: process.exitCode };
}

describe('importCommand', () => {
  let dir: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-import-cmd-'));
    cacheDir = await mkdtemp(join(tmpdir(), 'forgemap-cache-'));
    process.env.XDG_CACHE_HOME = cacheDir;
    repos = {};
    ghResponses = {};
    setUrlCalls = [];
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockImplementation(
      async (cmd: string, args: string[], opts?: { cwd?: string }) => {
        const cwd = opts?.cwd ?? '';
        const state = repos[cwd];
        if (cmd === 'git') {
          if (args[0] === 'rev-parse')
            return state?.isRepo ? ok('true') : fail();
          if (args[0] === 'config') {
            return ok(state?.origin ? `remote.origin.url ${state.origin}` : '');
          }
          if (args[0] === 'remote' && args[1] === 'get-url') {
            return state?.origin ? ok(state.origin) : fail();
          }
          if (args[0] === 'remote' && args[1] === 'set-url') {
            setUrlCalls.push({ cwd, url: String(args[3]) });
            return ok('');
          }
          if (args[0] === 'ls-remote') {
            return state?.lsRemote === 'gone' ? fail() : ok('');
          }
        }
        if (cmd === 'gh' && args[0] === 'api' && args[1] === 'graphql') {
          const query = String(args[3] ?? '');
          const data: Record<string, { nameWithOwner: string } | null> = {};
          const re = /r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g;
          for (let m = re.exec(query); m; m = re.exec(query)) {
            const slug = `${m[2]}/${m[3]}`;
            data[`r${m[1]}`] =
              ghResponses[slug] === slug ? { nameWithOwner: slug } : null;
          }
          return ok(JSON.stringify({ data }));
        }
        if (cmd === 'gh' && args[0] === 'api') {
          const slug = String(args[1]).replace('repos/', '');
          return ghResponses[slug]
            ? ok(ghResponses[slug]!)
            : fail('404 Not Found');
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

  async function makeRepo(serverDir: string, owner: string, repo: string) {
    const local = join(dir, serverDir, owner, repo);
    await mkdir(local, { recursive: true });
    return local;
  }

  it('rejects an invalid --type', async () => {
    const { exit } = await runImport({ path: dir, type: 'svn' });
    expect(exit).toBe(1);
  });

  it('rejects an invalid --format', async () => {
    const { exit } = await runImport({ path: dir, format: 'yaml' });
    expect(exit).toBe(1);
  });

  it('exits 1 when the path does not exist', async () => {
    const { exit } = await runImport({ path: join(dir, 'nope') });
    expect(exit).toBe(1);
  });

  it('emits the documented JSON shape', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/bar.git' };
    ghResponses['foo/bar'] = 'foo/bar';

    const { out } = await runImport({ path: dir, format: 'json' });
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe('forgemap');
    expect(parsed.summary.repos).toBe(1);
    expect(parsed.derived.forges['github.com'].type).toBe('github');
    expect(parsed.repos[0].owner).toBe('foo');
  });

  it('does not move folders without --fix', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/renamed.git' };
    ghResponses['foo/renamed'] = 'foo/renamed';

    await runImport({ path: dir, format: 'json' });
    expect(existsSync(local)).toBe(true);
    expect(existsSync(join(dir, 'github.com', 'foo', 'renamed'))).toBe(false);
  });

  it('applies folder moves and origin updates with --fix', async () => {
    const local = await makeRepo('github.com', 'old', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:old/bar.git' };
    ghResponses['old/bar'] = 'new/bar';
    // origin says old/bar (matches folder) but remote moved to new/bar
    // → set-origin-url fix to the canonical URL.

    await runImport({ path: dir, format: 'json', fix: true });
    expect(setUrlCalls).toEqual([
      { cwd: local, url: 'https://github.com/new/bar.git' }
    ]);
  });

  it('writes a derived config by default', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/bar.git' };
    ghResponses['foo/bar'] = 'foo/bar';

    await runImport({ path: dir, format: 'json' });
    const written = await readFile(join(dir, 'forgemap.config.ts'), 'utf8');
    expect(written).toContain("dir: 'github.com'");
    expect(written).toContain("type: 'github'");
    // A dotted server dir is not a bare identifier — the key must be quoted.
    expect(written).toContain("'github.com': {");
  });

  it('suppresses config writing with --no-write-config', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/bar.git' };
    ghResponses['foo/bar'] = 'foo/bar';

    await runImport({ path: dir, format: 'json', 'write-config': false });
    expect(existsSync(join(dir, 'forgemap.config.ts'))).toBe(false);
  });
});
