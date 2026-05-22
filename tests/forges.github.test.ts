import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: vi.fn(),
  execInherit: vi.fn()
}));

import { execInherit, hasCommand } from '../src/utils/exec.ts';
import { githubAdapter } from '../src/forges/github.ts';

const mockedHasCommand = vi.mocked(hasCommand);
const mockedExec = vi.mocked(execInherit);

const baseOpts = {
  forge: { type: 'github' as const, host: 'github.com', dir: 'gh' },
  owner: 'foo',
  repo: 'bar',
  dest: '/tmp/foo/bar'
};

describe('githubAdapter.clone', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws if gh is missing', async () => {
    mockedHasCommand.mockResolvedValue(false);
    await expect(githubAdapter.clone(baseOpts)).rejects.toThrow(/GitHub CLI/);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('shells out to `gh repo clone` and succeeds on exit 0', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedExec.mockResolvedValue({ code: 0 });
    await expect(githubAdapter.clone(baseOpts)).resolves.toBeUndefined();
    expect(mockedExec).toHaveBeenCalledWith('gh', [
      'repo',
      'clone',
      'foo/bar',
      '/tmp/foo/bar'
    ]);
  });

  it('throws when gh exits non-zero', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedExec.mockResolvedValue({ code: 1 });
    await expect(githubAdapter.clone(baseOpts)).rejects.toThrow(
      /exited with code 1/
    );
  });
});
