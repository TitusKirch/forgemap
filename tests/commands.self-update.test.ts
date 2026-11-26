import { readFileSync } from 'node:fs';
import consola from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallInfo } from '../src/install/detect.ts';
import { runCli } from './helpers/citty.ts';

const { classifyInstallMock, fetchLatestVersionMock, execInheritMock } =
  vi.hoisted(() => ({
    classifyInstallMock: vi.fn(),
    fetchLatestVersionMock: vi.fn(),
    execInheritMock: vi.fn()
  }));

// Only the two edges are mocked — the install probe (which would otherwise read
// this test runner's own binary path) and the network. `updateBlocker`,
// `formatCommand` and the version comparison stay real, so what the command
// does with them is actually under test.
vi.mock('../src/install/detect.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/install/detect.ts')>();
  return { ...actual, classifyInstall: classifyInstallMock };
});
vi.mock('../src/install/registry.ts', () => ({
  fetchLatestVersion: fetchLatestVersionMock
}));
vi.mock('../src/utils/exec.ts', () => ({ execInherit: execInheritMock }));

import { selfUpdateCommand } from '../src/commands/self-update.ts';

/** The version vite's `define` inlines into the command under test. */
const { version: CURRENT } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

const NEWER = '999.0.0';

function installOf(overrides: Partial<InstallInfo> = {}): InstallInfo {
  return {
    kind: 'pnpm-global',
    packageRoot: '/home/u/.local/share/pnpm/global/5/.pnpm/forgemap/x',
    reason: "pnpm's global store",
    command: { bin: 'pnpm', args: ['add', '-g', 'forgemap@latest'] },
    writable: true,
    ...overrides
  };
}

function given(
  install: Partial<InstallInfo>,
  latest: string | null = NEWER,
  error: string | null = null
): void {
  classifyInstallMock.mockReturnValue(installOf(install));
  fetchLatestVersionMock.mockResolvedValue({ version: latest, error });
}

/** Pretend stdin is a terminal, so the confirmation path is reachable. */
function withTty<T>(run: () => Promise<T>): Promise<T> {
  const saved = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', {
    value: true,
    configurable: true
  });
  return run().finally(() => {
    if (saved) Object.defineProperty(process.stdin, 'isTTY', saved);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  });
}

describe('selfUpdateCommand', () => {
  beforeEach(() => {
    classifyInstallMock.mockReset();
    fetchLatestVersionMock.mockReset();
    execInheritMock.mockReset();
    execInheritMock.mockResolvedValue({ code: 0 });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe('--print', () => {
    it('prints the command without asking the registry', async () => {
      given({});
      const { lines, exit } = await runCli(selfUpdateCommand, ['--print']);
      expect(lines).toEqual(['pnpm add -g forgemap@latest']);
      expect(fetchLatestVersionMock).not.toHaveBeenCalled();
      expect(execInheritMock).not.toHaveBeenCalled();
      expect(exit).toBeUndefined();
    });

    it('fails when this install has no command', async () => {
      given({ kind: 'linked', command: null, writable: false });
      const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
      const { out, exit } = await runCli(selfUpdateCommand, ['--print']);
      expect(out).toBe('');
      expect(exit).toBe(1);
      expect(error.mock.calls[0]?.[0]).toContain('linked dev build');
    });
  });

  describe('version check', () => {
    it('reports an up-to-date install and runs nothing', async () => {
      given({}, CURRENT);
      const success = vi.spyOn(consola, 'success').mockImplementation(() => {});
      const { exit } = await runCli(selfUpdateCommand, []);
      expect(success.mock.calls[0]?.[0]).toContain('is up to date');
      expect(execInheritMock).not.toHaveBeenCalled();
      expect(exit).toBeUndefined();
    });

    it('names the registry version when the local build is ahead', async () => {
      given({}, '0.0.1');
      const success = vi.spyOn(consola, 'success').mockImplementation(() => {});
      await runCli(selfUpdateCommand, []);
      expect(success.mock.calls[0]?.[0]).toContain('registry latest: v0.0.1');
    });

    it('fails loudly when the registry is unreachable', async () => {
      given({}, null, 'the registry did not answer within 5000 ms');
      const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
      const info = vi.spyOn(consola, 'info').mockImplementation(() => {});
      const { exit } = await runCli(selfUpdateCommand, []);
      expect(error.mock.calls[0]?.[0]).toContain('did not answer');
      expect(info.mock.calls[0]?.[0]).toContain('pnpm add -g forgemap@latest');
      expect(execInheritMock).not.toHaveBeenCalled();
      expect(exit).toBe(1);
    });

    it('--check reports the update and exits 1 without prompting', async () => {
      given({});
      const prompt = vi.spyOn(consola, 'prompt');
      const { out, exit } = await runCli(selfUpdateCommand, ['--check']);
      expect(out).toContain('pnpm add -g forgemap@latest');
      expect(out).toContain('pnpm-global');
      expect(prompt).not.toHaveBeenCalled();
      expect(execInheritMock).not.toHaveBeenCalled();
      expect(exit).toBe(1);
    });
  });

  describe('--json', () => {
    it('reports the update, the install and the command', async () => {
      given({});
      const { out, exit } = await runCli(selfUpdateCommand, ['--json']);
      expect(JSON.parse(out)).toEqual({
        current: CURRENT,
        latest: NEWER,
        outdated: true,
        install: {
          kind: 'pnpm-global',
          packageRoot: '/home/u/.local/share/pnpm/global/5/.pnpm/forgemap/x',
          reason: "pnpm's global store",
          writable: true
        },
        command: 'pnpm add -g forgemap@latest',
        blocked: null,
        error: null
      });
      expect(exit).toBe(1);
    });

    it('exits 0 when up to date', async () => {
      given({}, CURRENT);
      const { out, exit } = await runCli(selfUpdateCommand, ['--json']);
      expect(JSON.parse(out)).toMatchObject({ outdated: false, error: null });
      expect(exit).toBeUndefined();
    });

    it('carries the blocker and the registry error', async () => {
      given({ kind: 'project', command: null }, null, 'boom');
      const { out, exit } = await runCli(selfUpdateCommand, ['--json']);
      expect(JSON.parse(out)).toMatchObject({
        command: null,
        blocked: expect.stringContaining('package.json'),
        error: 'boom'
      });
      expect(exit).toBe(1);
    });
  });

  describe('blocked installs', () => {
    it.each<[string, Partial<InstallInfo>, string]>([
      ['linked', { kind: 'linked', command: null }, 'dev build'],
      ['ephemeral', { kind: 'ephemeral', command: null }, 'npx/dlx'],
      ['project', { kind: 'project', command: null }, 'package.json'],
      ['unknown', { kind: 'unknown', command: null }, 'recognised'],
      ['unwritable', { writable: false }, 'not writable']
    ])('refuses to run on a %s install', async (_name, install, expected) => {
      given({ writable: false, ...install });
      const warn = vi.spyOn(consola, 'warn').mockImplementation(() => {});
      vi.spyOn(consola, 'info').mockImplementation(() => {});
      const { exit } = await runCli(selfUpdateCommand, ['--yes']);
      expect(warn.mock.calls[0]?.[0]).toContain(expected);
      expect(execInheritMock).not.toHaveBeenCalled();
      expect(exit).toBe(1);
    });

    it('still names a generic global install when nothing is recognised', async () => {
      given({ kind: 'unknown', command: null, writable: false });
      vi.spyOn(consola, 'warn').mockImplementation(() => {});
      const info = vi.spyOn(consola, 'info').mockImplementation(() => {});
      await runCli(selfUpdateCommand, ['--yes']);
      expect(info.mock.calls.at(-1)?.[0]).toContain(
        'npm install -g forgemap@latest'
      );
    });
  });

  describe('confirmation', () => {
    it('refuses to update without --yes when there is no TTY', async () => {
      given({});
      const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
      const { exit } = await runCli(selfUpdateCommand, []);
      expect(error.mock.calls[0]?.[0]).toContain('without --yes');
      expect(execInheritMock).not.toHaveBeenCalled();
      expect(exit).toBe(1);
    });

    it('runs the installer after the literal "yes"', async () => {
      given({});
      const prompt = vi
        .spyOn(consola, 'prompt')
        .mockResolvedValue('  yes  ' as never);
      vi.spyOn(consola, 'success').mockImplementation(() => {});
      const { exit } = await withTty(() => runCli(selfUpdateCommand, []));
      expect(prompt).toHaveBeenCalledOnce();
      expect(execInheritMock).toHaveBeenCalledWith('pnpm', [
        'add',
        '-g',
        'forgemap@latest'
      ]);
      expect(exit).toBeUndefined();
    });

    it.each(['no', 'y', '', null])('aborts on %j', async (answer) => {
      given({});
      vi.spyOn(consola, 'prompt').mockResolvedValue(answer as never);
      const info = vi.spyOn(consola, 'info').mockImplementation(() => {});
      await withTty(() => runCli(selfUpdateCommand, []));
      expect(info.mock.calls.at(-1)?.[0]).toContain('Aborted');
      expect(execInheritMock).not.toHaveBeenCalled();
    });

    it('--yes skips the prompt entirely', async () => {
      given({});
      const prompt = vi.spyOn(consola, 'prompt');
      vi.spyOn(consola, 'success').mockImplementation(() => {});
      await runCli(selfUpdateCommand, ['--yes']);
      expect(prompt).not.toHaveBeenCalled();
      expect(execInheritMock).toHaveBeenCalledOnce();
    });
  });

  describe('running the installer', () => {
    it('reports success with the version it moved to', async () => {
      given({});
      const success = vi.spyOn(consola, 'success').mockImplementation(() => {});
      await runCli(selfUpdateCommand, ['--yes']);
      expect(success.mock.calls[0]?.[0]).toContain(`v${NEWER}`);
    });

    it('hands back the installer’s exit code', async () => {
      given({});
      execInheritMock.mockResolvedValue({ code: 17 });
      const fail = vi.spyOn(consola, 'fail').mockImplementation(() => {});
      const { exit } = await runCli(selfUpdateCommand, ['--yes']);
      expect(fail.mock.calls[0]?.[0]).toContain('exited with code 17');
      expect(exit).toBe(17);
    });
  });
});
