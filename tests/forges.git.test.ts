import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: vi.fn(),
  execInherit: vi.fn(),
  execCapture: vi.fn()
}));

import type { GitForgeConfig } from '../src/config/schema.ts';
import { __test, gitAdapter } from '../src/forges/git.ts';
import { execCapture, execInherit, hasCommand } from '../src/utils/exec.ts';

const mockedHasCommand = vi.mocked(hasCommand);
const mockedExec = vi.mocked(execInherit);
const mockedCapture = vi.mocked(execCapture);

const forge: GitForgeConfig = {
  type: 'git',
  host: 'gitlab.acme.com',
  dir: 'gl'
};

describe('git adapter URL builder', () => {
  it('defaults to SSH', () => {
    expect(
      __test.buildCloneUrl({
        forge,
        owner: 'team',
        repo: 'api'
      })
    ).toBe('git@gitlab.acme.com:team/api.git');
  });

  it('honours forge-config protocol https', () => {
    const httpsForge: GitForgeConfig = { ...forge, protocol: 'https' };
    expect(
      __test.buildCloneUrl({
        forge: httpsForge,
        owner: 'team',
        repo: 'api'
      })
    ).toBe('https://gitlab.acme.com/team/api.git');
  });

  it('lets per-call protocol override the config', () => {
    const httpsForge: GitForgeConfig = { ...forge, protocol: 'https' };
    expect(
      __test.buildCloneUrl({
        forge: httpsForge,
        owner: 'team',
        repo: 'api',
        protocol: 'ssh'
      })
    ).toBe('git@gitlab.acme.com:team/api.git');
  });
});

describe('gitAdapter.clone', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when git is missing', async () => {
    mockedHasCommand.mockResolvedValue(false);
    await expect(
      gitAdapter.clone({ forge, owner: 'team', repo: 'api', dest: '/tmp/api' })
    ).rejects.toThrow(/git.*not installed/);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('invokes git clone with the built URL on success', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedExec.mockResolvedValue({ code: 0 });
    await gitAdapter.clone({
      forge,
      owner: 'team',
      repo: 'api',
      dest: '/tmp/api'
    });
    expect(mockedExec).toHaveBeenCalledWith('git', [
      'clone',
      'git@gitlab.acme.com:team/api.git',
      '/tmp/api'
    ]);
  });

  it('throws when git clone exits non-zero', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedExec.mockResolvedValue({ code: 128 });
    await expect(
      gitAdapter.clone({ forge, owner: 'team', repo: 'api', dest: '/tmp/api' })
    ).rejects.toThrow(/exited with code 128/);
  });
});

describe('gitAdapter.checkRemote', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns exists when ls-remote succeeds', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({ code: 0, stdout: 'refs', stderr: '' });
    expect(
      await gitAdapter.checkRemote!({ forge, owner: 'team', repo: 'api' })
    ).toEqual({ state: 'exists', canonical: { owner: 'team', repo: 'api' } });
    expect(mockedCapture).toHaveBeenCalledWith(
      'git',
      ['ls-remote', 'git@gitlab.acme.com:team/api.git'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it('prefers the supplied origin URL', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    await gitAdapter.checkRemote!({
      forge,
      owner: 'team',
      repo: 'api',
      originUrl: 'https://gitlab.acme.com/team/api.git'
    });
    expect(mockedCapture).toHaveBeenCalledWith(
      'git',
      ['ls-remote', 'https://gitlab.acme.com/team/api.git'],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it('returns gone only on an explicit repository-not-found error', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 128,
      stdout: '',
      stderr: 'ERROR: Repository not found.\nfatal: Could not read from remote'
    });
    expect(
      await gitAdapter.checkRemote!({ forge, owner: 'team', repo: 'api' })
    ).toEqual({ state: 'gone' });
  });

  it('returns unknown (not gone) for an unreachable host', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 128,
      stdout: '',
      stderr:
        'ssh: connect to host www.example.com port 22: Connection timed out\nfatal: Could not read from remote repository.'
    });
    const result = await gitAdapter.checkRemote!({
      forge,
      owner: 'team',
      repo: 'api'
    });
    expect(result.state).toBe('unknown');
    expect(result).toMatchObject({
      reason: expect.stringContaining('Connection timed out')
    });
  });

  it('treats the generic SSH access error as unknown, not gone', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 128,
      stdout: '',
      stderr:
        'fatal: Could not read from remote repository.\nPlease make sure you have the correct access rights\nand the repository exists.'
    });
    expect(
      (await gitAdapter.checkRemote!({ forge, owner: 'team', repo: 'api' }))
        .state
    ).toBe('unknown');
  });

  it('returns unknown (not gone) when ls-remote times out', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 143,
      stdout: '',
      stderr: '',
      timedOut: true
    });
    expect(
      await gitAdapter.checkRemote!({ forge, owner: 'team', repo: 'api' })
    ).toEqual({ state: 'unknown', reason: 'ls-remote timed out' });
  });
});
