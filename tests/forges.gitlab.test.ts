import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: vi.fn(),
  execInherit: vi.fn(),
  execCapture: vi.fn()
}));

import { gitlabAdapter } from '../src/forges/gitlab.ts';
import { execCapture, execInherit, hasCommand } from '../src/utils/exec.ts';

const mockedHasCommand = vi.mocked(hasCommand);
const mockedExec = vi.mocked(execInherit);
const mockedCapture = vi.mocked(execCapture);

const forge = {
  type: 'gitlab' as const,
  host: 'gitlab.acme.com',
  dir: 'comGitlabAcme'
};

const baseRemote = { forge, owner: 'group/sub', repo: 'api' };
const baseOpts = { ...baseRemote, dest: '/tmp/group/sub/api' };

describe('gitlabAdapter.clone', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws if glab is missing', async () => {
    mockedHasCommand.mockResolvedValue(false);
    await expect(gitlabAdapter.clone(baseOpts)).rejects.toThrow(/GitLab CLI/);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('passes the full subgroup path to `glab repo clone` as one argument', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedExec.mockResolvedValue({ code: 0 });
    await expect(gitlabAdapter.clone(baseOpts)).resolves.toBeUndefined();
    expect(mockedExec).toHaveBeenCalledWith(
      'glab',
      ['repo', 'clone', 'group/sub/api', '/tmp/group/sub/api'],
      { env: { GITLAB_HOST: 'gitlab.acme.com' } }
    );
  });

  it('throws when glab exits non-zero', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedExec.mockResolvedValue({ code: 1 });
    await expect(gitlabAdapter.clone(baseOpts)).rejects.toThrow(
      /exited with code 1/
    );
  });
});

describe('gitlabAdapter.checkRemote', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns unknown when glab is missing', async () => {
    mockedHasCommand.mockResolvedValue(false);
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'glab not installed'
    });
  });

  it('url-encodes the project path and pins the host', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ path_with_namespace: 'group/sub/api' }),
      stderr: ''
    });

    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'exists',
      canonical: { owner: 'group/sub', repo: 'api' }
    });
    expect(mockedCapture).toHaveBeenCalledWith(
      'glab',
      ['api', 'projects/group%2Fsub%2Fapi'],
      expect.objectContaining({
        env: { GITLAB_HOST: 'gitlab.acme.com' },
        timeoutMs: expect.any(Number)
      })
    );
  });

  it('returns moved when path_with_namespace differs', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ path_with_namespace: 'group/other/api' }),
      stderr: ''
    });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'moved',
      canonical: { owner: 'group/other', repo: 'api' },
      canonicalUrl: 'https://gitlab.acme.com/group/other/api.git'
    });
  });

  it('returns gone when the project is not found', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: '404 Project Not Found'
    });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'gone'
    });
  });

  it('returns unknown on any other failure', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'dial tcp: lookup gitlab.acme.com: no such host'
    });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'dial tcp: lookup gitlab.acme.com: no such host'
    });
  });

  it('returns unknown when the call times out', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 124,
      stdout: '',
      stderr: '',
      timedOut: true
    });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'glab api timed out'
    });
  });

  it('returns unknown when the path has no namespace to split off', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ path_with_namespace: 'orphan' }),
      stderr: ''
    });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'could not parse glab api path_with_namespace'
    });
  });

  it('falls back to the exit code when glab says nothing on stderr', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({ code: 7, stdout: '', stderr: '' });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'glab api exited with code 7'
    });
  });

  it('returns unknown when the payload cannot be read', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: 'not json',
      stderr: ''
    });
    expect(await gitlabAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'could not parse glab api path_with_namespace'
    });
  });
});

describe('gitlabAdapter.checkRemotes (batch)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const inputs = [
    { forge, owner: 'group/sub', repo: 'api' },
    { forge, owner: 'kirchDev', repo: 'gitlab-test' }
  ];

  it('returns [] for no inputs without shelling out', async () => {
    expect(await gitlabAdapter.checkRemotes!([])).toEqual([]);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('returns unknown for all when glab is missing', async () => {
    mockedHasCommand.mockResolvedValue(false);
    expect(await gitlabAdapter.checkRemotes!(inputs)).toEqual([
      { state: 'unknown', reason: 'glab not installed' },
      { state: 'unknown', reason: 'glab not installed' }
    ]);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('resolves every hit from one aliased GraphQL call', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        data: {
          r0: { fullPath: 'group/sub/api' },
          r1: { fullPath: 'kirchDev/gitlab-test' }
        }
      }),
      stderr: ''
    });

    expect(await gitlabAdapter.checkRemotes!(inputs)).toEqual([
      { state: 'exists', canonical: { owner: 'group/sub', repo: 'api' } },
      {
        state: 'exists',
        canonical: { owner: 'kirchDev', repo: 'gitlab-test' }
      }
    ]);
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(mockedCapture).toHaveBeenCalledWith(
      'glab',
      [
        'api',
        'graphql',
        '-f',
        expect.stringContaining('project(fullPath: "group/sub/api")')
      ],
      expect.objectContaining({ env: { GITLAB_HOST: 'gitlab.acme.com' } })
    );
  });

  it('falls back to one REST call per miss to tell moved from gone', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockImplementation(async (_cmd, args: string[]) => {
      if (args[1] === 'graphql') {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: { r0: { fullPath: 'group/sub/api' }, r1: null }
          }),
          stderr: ''
        };
      }
      return { code: 1, stdout: '', stderr: '404 Project Not Found' };
    });

    const out = await gitlabAdapter.checkRemotes!(inputs);
    expect(out[0]).toEqual({
      state: 'exists',
      canonical: { owner: 'group/sub', repo: 'api' }
    });
    expect(out[1]).toEqual({ state: 'gone' });
  });

  it('reads an unwrapped GraphQL payload as readily as a data-wrapped one', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        r0: { fullPath: 'group/sub/api' },
        r1: { fullPath: 'kirchDev/gitlab-test' }
      }),
      stderr: ''
    });

    const out = await gitlabAdapter.checkRemotes!(inputs);
    expect(out.map((r) => r.state)).toEqual(['exists', 'exists']);
    expect(mockedCapture).toHaveBeenCalledTimes(1);
  });

  it('treats an unsplittable fullPath as a miss and asks REST', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockImplementation(async (_cmd, args: string[]) => {
      if (args[1] === 'graphql') {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: { r0: { fullPath: 'orphan' }, r1: { fullPath: 'a/b' } }
          }),
          stderr: ''
        };
      }
      return { code: 1, stdout: '', stderr: '404 Project Not Found' };
    });

    const out = await gitlabAdapter.checkRemotes!(inputs);
    expect(out[0]).toEqual({ state: 'gone' });
    expect(out[1]).toEqual({
      state: 'exists',
      canonical: { owner: 'a', repo: 'b' }
    });
  });

  it('sends every input to REST when the GraphQL payload is unreadable', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockImplementation(async (_cmd, args: string[]) => {
      if (args[1] === 'graphql') {
        return { code: 1, stdout: 'boom', stderr: 'unauthorized' };
      }
      return { code: 1, stdout: '', stderr: '404 Project Not Found' };
    });

    const out = await gitlabAdapter.checkRemotes!(inputs);
    expect(out).toEqual([{ state: 'gone' }, { state: 'gone' }]);
    // One GraphQL attempt plus one REST call per unresolved input.
    expect(mockedCapture).toHaveBeenCalledTimes(3);
  });
});
