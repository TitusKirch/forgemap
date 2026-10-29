import { describe, expect, it, vi } from 'vitest';

const { getOriginUrlMock, classifyRemotesMock } = vi.hoisted(() => ({
  getOriginUrlMock: vi.fn(),
  classifyRemotesMock: vi.fn()
}));

vi.mock('../src/repos/git.ts', () => ({
  getOriginUrl: getOriginUrlMock,
  setOriginUrl: vi.fn()
}));
vi.mock('../src/repos/evaluate.ts', () => ({
  classifyRemotes: classifyRemotesMock
}));

import type { ForgeMapConfig } from '../src/config/schema.ts';
import { planMoves, rewriteOriginPath } from '../src/repos/move.ts';
import type { ScannedRepo } from '../src/repos/scan.ts';

const config: ForgeMapConfig = {
  root: '/r',
  defaultForge: 'gl',
  forges: {
    gl: { type: 'gitlab', host: 'gitlab.com', dir: 'comGitlab' },
    gh: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};

function repo(owner: string, name: string): ScannedRepo {
  return {
    forgeName: 'gl',
    forge: config.forges.gl!,
    owner,
    repo: name,
    localPath: `/r/comGitlab/${owner}/${name}`,
    slug: `${owner}/${name}`
  };
}

describe('rewriteOriginPath', () => {
  it('keeps the ssh form and .git suffix', () => {
    expect(rewriteOriginPath('git@github.com:a/b.git', 'c', 'd')).toBe(
      'git@github.com:c/d.git'
    );
  });

  it('keeps scheme, user and host of an https remote', () => {
    expect(rewriteOriginPath('https://me@gitlab.com/g/sub/b', 'x/y', 'z')).toBe(
      'https://me@gitlab.com/x/y/z'
    );
  });
});

describe('planMoves', () => {
  const options = { config, configDir: '/', remoteCheck: true };

  it('refuses a target nested inside the repo itself', async () => {
    getOriginUrlMock.mockResolvedValue('git@gitlab.com:g/app/inner.git');
    classifyRemotesMock.mockResolvedValue(new Map());
    const [check] = await planMoves([repo('g', 'app')], options);
    expect(check).toMatchObject({ kind: 'skip' });
    expect((check as { reason: string }).reason).toContain('inside the repo');
  });

  it('skips when the moved-to location cannot be resolved', async () => {
    getOriginUrlMock.mockResolvedValue('git@github.com:a/b.git');
    const r = { ...repo('a', 'b'), localPath: '/r/comGithub/a/b' };
    classifyRemotesMock.mockResolvedValue(
      new Map([
        [
          r.localPath,
          { state: 'moved', canonical: { owner: 'x/y', repo: 'z' } }
        ]
      ])
    );
    const [check] = await planMoves([r], options);
    expect(check).toMatchObject({ kind: 'skip' });
  });

  it('asks the forge the origin points at, not the folder’s', async () => {
    getOriginUrlMock.mockResolvedValue('git@github.com:a/b.git');
    classifyRemotesMock.mockResolvedValue(new Map());
    await planMoves([repo('a', 'b')], options);
    const candidates = classifyRemotesMock.mock.calls.at(-1)![0];
    expect(candidates[0].repo.forge.type).toBe('github');
    expect(candidates[0].repo.localPath).toBe('/r/comGitlab/a/b');
  });
});
