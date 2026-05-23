import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      'no-cache': true,
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

  beforeEach(async () => {
    dir = await setup();
    fetchRepoMock.mockReset();
    pullRepoMock.mockReset();
    isCleanMock.mockReset();
    fetchRepoMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    pullRepoMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    isCleanMock.mockResolvedValue(true);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
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

  it('exits 1 when any fetch fails', async () => {
    fetchRepoMock.mockImplementation(async (p: string) =>
      p.includes('foo/a')
        ? { code: 1, stdout: '', stderr: 'boom' }
        : { code: 0, stdout: '', stderr: '' }
    );
    const exit = await runSync(dir);
    expect(exit).toBe(1);
  });
});
