import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        'no-cache': true,
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
 * which injects `args` directly. Repeated flags only behave correctly on this
 * path, so the `--filter` repetition tests have to go through it.
 */
async function runStatusArgv(dir: string, extra: string[]): Promise<string> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await runCommand(statusCommand, {
      rawArgs: [
        '--config',
        join(dir, 'forgemap.config.ts'),
        '--no-cache',
        ...extra
      ]
    });
  } finally {
    process.stdout.write = original;
  }
  return writes.join('');
}

describe('statusCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await setup();
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
});
