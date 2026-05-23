import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: vi.fn(),
  execInherit: vi.fn(),
  execCapture: vi.fn()
}));

import { execCapture, execInherit, hasCommand } from '../src/utils/exec.ts';
import { githubAdapter } from '../src/forges/github.ts';

const mockedHasCommand = vi.mocked(hasCommand);
const mockedExec = vi.mocked(execInherit);
const mockedCapture = vi.mocked(execCapture);

const baseRemote = {
  forge: { type: 'github' as const, host: 'github.com', dir: 'gh' },
  owner: 'foo',
  repo: 'bar'
};

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

describe('githubAdapter.checkRemote', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns unknown when gh is missing', async () => {
    mockedHasCommand.mockResolvedValue(false);
    expect(await githubAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'unknown',
      reason: 'gh not installed'
    });
  });

  it('returns exists when full_name matches', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: 'foo/bar\n',
      stderr: ''
    });
    expect(await githubAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'exists',
      canonical: { owner: 'foo', repo: 'bar' }
    });
  });

  it('returns moved when full_name differs', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 0,
      stdout: 'new/bar\n',
      stderr: ''
    });
    expect(await githubAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'moved',
      canonical: { owner: 'new', repo: 'bar' },
      canonicalUrl: 'https://github.com/new/bar.git'
    });
  });

  it('returns gone on 404', async () => {
    mockedHasCommand.mockResolvedValue(true);
    mockedCapture.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'gh: HTTP 404: Not Found'
    });
    expect(await githubAdapter.checkRemote!(baseRemote)).toEqual({
      state: 'gone'
    });
  });
});
