import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from 'citty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process'
    );
  return {
    ...actual,
    spawn: spawnMock
  };
});

import { openCommand } from '../src/commands/open.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

function fakeChild() {
  return {
    on: vi.fn(),
    unref: vi.fn()
  };
}

/** Driven through citty's real argument parsing, not an injected args object. */
async function runOpen(dir: string, slug: string): Promise<void> {
  await runCommand(openCommand, {
    rawArgs: [slug, '--config', join(dir, 'forgemap.config.ts')]
  });
}

describe('openCommand', () => {
  let dir: string;
  let originalDistro: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-open-'));
    await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
    await mkdir(join(dir, 'comGithub', 'kirchDev', 'gildmaster'), {
      recursive: true
    });
    await mkdir(join(dir, 'comGithub', 'acme', 'gildhall'), {
      recursive: true
    });
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeChild());
    originalDistro = process.env.WSL_DISTRO_NAME;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    if (originalDistro === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = originalDistro;
  });

  it('uses explorer.exe with UNC path on WSL', async () => {
    process.env.WSL_DISTRO_NAME = 'Ubuntu';
    await runOpen(dir, 'foo/bar');

    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('explorer.exe');
    expect(args[0]).toMatch(/^\\\\wsl\$\\Ubuntu\\/);
    expect(args[0]).toMatch(/comGithub\\foo\\bar$/);
  });

  it('uses xdg-open on plain Linux', async () => {
    delete process.env.WSL_DISTRO_NAME;
    await runOpen(dir, 'foo/bar');

    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('xdg-open');
    expect(args[0]).toBe(join(dir, 'comGithub', 'foo', 'bar'));
  });

  it('reports ENOENT when the platform opener is missing', async () => {
    delete process.env.WSL_DISTRO_NAME;
    const handlers = new Map<string, (err: NodeJS.ErrnoException) => void>();
    spawnMock.mockReturnValue({
      on: vi.fn((event: string, fn: (err: NodeJS.ErrnoException) => void) => {
        handlers.set(event, fn);
      }),
      unref: vi.fn()
    });
    process.exitCode = undefined;
    await runOpen(dir, 'foo/bar');
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    handlers.get('error')?.(err);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('opens the single repo a bare fuzzy term matches', async () => {
    delete process.env.WSL_DISTRO_NAME;
    await runOpen(dir, 'gildmaster');

    const [cmd, args] = spawnMock.mock.calls[0]!;
    expect(cmd).toBe('xdg-open');
    expect(args[0]).toBe(join(dir, 'comGithub', 'kirchDev', 'gildmaster'));
  });

  it('opens nothing when a fuzzy term is ambiguous', async () => {
    delete process.env.WSL_DISTRO_NAME;
    process.exitCode = undefined;
    await runOpen(dir, 'gild');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
