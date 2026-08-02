import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import {
  findEmptyDirs,
  type GateOverrides,
  localBlocker,
  localGateOverride,
  pruneEmptyDirs,
  type RepoEvaluation,
  remoteBlocker
} from '../src/repos/evaluate.ts';

const NONE: GateOverrides = {
  includeDirty: false,
  includeUnpushed: false,
  includeStashed: false
};

function evaluation(state: Partial<RepoEvaluation> = {}): RepoEvaluation {
  return {
    repo: {
      forgeName: 'gh',
      forge: { type: 'github', dir: 'comGithub' },
      owner: 'foo',
      repo: 'bar',
      slug: 'foo/bar',
      localPath: '/tmp/foo/bar'
    } as RepoEvaluation['repo'],
    origin: 'git@github.com:foo/bar.git',
    owner: 'foo',
    name: 'bar',
    lastCommitUnix: 0,
    dirty: false,
    unpushed: false,
    stashes: 0,
    ...state
  };
}

describe('localBlocker', () => {
  it('passes a repo with no local work', () => {
    expect(localBlocker(evaluation(), NONE)).toBeNull();
  });

  it('blocks dirty, unpushed and stashed work', () => {
    expect(localBlocker(evaluation({ dirty: true }), NONE)).toBe(
      'uncommitted changes'
    );
    expect(localBlocker(evaluation({ unpushed: true }), NONE)).toBe(
      'unpushed commits'
    );
    expect(localBlocker(evaluation({ stashes: 1 }), NONE)).toBe(
      'stashed work (1 stash)'
    );
  });

  it('pluralises the stash count', () => {
    expect(localBlocker(evaluation({ stashes: 3 }), NONE)).toBe(
      'stashed work (3 stashes)'
    );
  });

  it('lets each --include flag override only its own gate', () => {
    const stashed = evaluation({ stashes: 2 });
    // Stashed work is separate work: the other escape hatches must not carry
    // it along.
    expect(localBlocker(stashed, { ...NONE, includeDirty: true })).toBe(
      'stashed work (2 stashes)'
    );
    expect(localBlocker(stashed, { ...NONE, includeUnpushed: true })).toBe(
      'stashed work (2 stashes)'
    );
    expect(localBlocker(stashed, { ...NONE, includeStashed: true })).toBeNull();
  });
});

describe('localGateOverride', () => {
  // Every reason localBlocker can produce must map back to the flag that
  // overrides it — otherwise the command refuses without telling the user how
  // to proceed.
  it('names the overriding flag for every local gate', () => {
    const cases: Array<[Partial<RepoEvaluation>, string]> = [
      [{ dirty: true }, '--include-dirty'],
      [{ unpushed: true }, '--include-unpushed'],
      [{ stashes: 1 }, '--include-stashed'],
      [{ stashes: 4 }, '--include-stashed']
    ];
    for (const [state, flag] of cases) {
      const reason = localBlocker(evaluation(state), NONE);
      expect(reason).not.toBeNull();
      expect(localGateOverride(reason as string)).toBe(flag);
    }
  });

  it('has no flag for a remote blocker — that gate is never overridable', () => {
    expect(localGateOverride('remote no longer exists')).toBeUndefined();
    expect(localGateOverride('remote unreachable')).toBeUndefined();
  });
});

describe('remoteBlocker', () => {
  it('allows an existing or moved remote', () => {
    expect(remoteBlocker('exists')).toBeNull();
    expect(remoteBlocker('moved')).toBeNull();
  });

  it('blocks a gone, unreachable or unknown remote', () => {
    expect(remoteBlocker('gone')).toBe('remote no longer exists');
    expect(remoteBlocker('unknown')).toBe('remote unreachable');
    expect(remoteBlocker(undefined)).toBe('remote unreachable');
  });
});

describe('findEmptyDirs', () => {
  let dir: string;

  const config: ForgeMapConfig = {
    root: '.',
    defaultForge: 'work',
    forges: {
      work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
    }
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-empty-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('collects a nested namespace left behind by a delete, deepest first', async () => {
    await mkdir(join(dir, 'comGitlabAcme', 'group', 'sub'), {
      recursive: true
    });

    expect(await findEmptyDirs(dir, config)).toEqual([
      join(dir, 'comGitlabAcme', 'group', 'sub'),
      join(dir, 'comGitlabAcme', 'group'),
      join(dir, 'comGitlabAcme')
    ]);
  });

  it('keeps a namespace that still holds a repo', async () => {
    await mkdir(join(dir, 'comGitlabAcme', 'group', 'sub', 'api', '.git'), {
      recursive: true
    });
    await mkdir(join(dir, 'comGitlabAcme', 'group', 'gone'), {
      recursive: true
    });

    expect(await findEmptyDirs(dir, config)).toEqual([
      join(dir, 'comGitlabAcme', 'group', 'gone')
    ]);
  });

  it('never walks into a repo, however empty its subdirectories are', async () => {
    const repo = join(dir, 'comGitlabAcme', 'group', 'api');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(join(repo, 'src', 'empty'), { recursive: true });

    expect(await findEmptyDirs(dir, config)).toEqual([]);
  });

  it('removes what it found, bottom-up', async () => {
    await mkdir(join(dir, 'comGitlabAcme', 'group', 'sub'), {
      recursive: true
    });

    expect(await pruneEmptyDirs(dir, config)).toBe(3);
    expect(existsSync(join(dir, 'comGitlabAcme'))).toBe(false);
  });
});
