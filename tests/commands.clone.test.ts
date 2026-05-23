import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloneMock = vi.fn();

vi.mock('../src/forges/registry.ts', () => ({
  getForgeAdapter: () => ({ clone: cloneMock })
}));

import { cloneCommand } from '../src/commands/clone.ts';

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
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-clone-test-'));
  await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  return dir;
}

async function runClone(
  dir: string,
  slug: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await cloneCommand.run!({
    args: {
      slug,
      config: join(dir, 'forgemap.config.ts'),
      ssh: false,
      https: false,
      ...extra,
      _: [slug]
    },
    rawArgs: [slug],
    cmd: cloneCommand,
    data: undefined
  } as never);
}

describe('cloneCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await setup();
    cloneMock.mockReset();
    cloneMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('calls the forge adapter for an un-cloned repo', async () => {
    await runClone(dir, 'foo/bar');
    expect(cloneMock).toHaveBeenCalledOnce();
    const arg = cloneMock.mock.calls[0]![0];
    expect(arg.owner).toBe('foo');
    expect(arg.repo).toBe('bar');
    expect(arg.dest).toBe(join(dir, 'comGithub', 'foo', 'bar'));
  });

  it('skips when the destination already exists', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    await runClone(dir, 'foo/bar');
    expect(cloneMock).not.toHaveBeenCalled();
  });

  it('exits 1 when --ssh and --https are combined', async () => {
    process.exitCode = undefined;
    await runClone(dir, 'foo/bar', { ssh: true, https: true });
    expect(process.exitCode).toBe(1);
    expect(cloneMock).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });

  it('passes --ssh through to the adapter for type:git forges', async () => {
    await runClone(dir, 'work:team/api', { ssh: true });
    expect(cloneMock).toHaveBeenCalledOnce();
    expect(cloneMock.mock.calls[0]![0].protocol).toBe('ssh');
  });

  it('passes --https through to the adapter for type:git forges', async () => {
    await runClone(dir, 'work:team/api', { https: true });
    expect(cloneMock).toHaveBeenCalledOnce();
    expect(cloneMock.mock.calls[0]![0].protocol).toBe('https');
  });

  it('warn-ignores --ssh on a github forge', async () => {
    await runClone(dir, 'foo/bar', { ssh: true });
    expect(cloneMock).toHaveBeenCalledOnce();
    expect(cloneMock.mock.calls[0]![0].protocol).toBeUndefined();
  });
});
