import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: vi.fn(),
  execInherit: vi.fn()
}));

import type { GitForgeConfig } from '../src/config/schema.ts';
import { __test, gitAdapter } from '../src/forges/git.ts';
import { execInherit, hasCommand } from '../src/utils/exec.ts';

const mockedHasCommand = vi.mocked(hasCommand);
const mockedExec = vi.mocked(execInherit);

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
        repo: 'api',
        dest: '/tmp/team/api'
      })
    ).toBe('git@gitlab.acme.com:team/api.git');
  });

  it('honours forge-config protocol https', () => {
    const httpsForge: GitForgeConfig = { ...forge, protocol: 'https' };
    expect(
      __test.buildCloneUrl({
        forge: httpsForge,
        owner: 'team',
        repo: 'api',
        dest: '/tmp/x'
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
        dest: '/tmp/x',
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
