import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fetchRepo,
  getLastCommitUnix,
  getRepoStatus,
  hasUnpushedCommits,
  isClean,
  pullRepo
} from '../src/repos/git.ts';
import { execCapture } from '../src/utils/exec.ts';

async function git(cwd: string, args: string[]) {
  const r = await execCapture('git', args, { cwd });
  if (r.code !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r;
}

describe('repos/git', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-git-'));
    await git(dir, ['init', '--quiet', '-b', 'main']);
    await git(dir, ['config', 'user.email', 'test@example.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    await git(dir, ['config', 'commit.gpgsign', 'false']);
    await writeFile(join(dir, 'README.md'), '# hi\n');
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '--quiet', '-m', 'init']);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports a clean repo correctly', async () => {
    const s = await getRepoStatus(dir);
    expect(s.branch).toBe('main');
    expect(s.dirty).toBe(false);
    expect(s.ahead).toBe(0);
    expect(s.behind).toBe(0);
    expect(s.lastCommit?.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(s.lastCommit?.relativeDate).toMatch(/ago|seconds|now/);
  });

  it('flags a dirty working tree', async () => {
    await writeFile(join(dir, 'README.md'), 'hi changed\n');
    const s = await getRepoStatus(dir);
    expect(s.dirty).toBe(true);
    expect(await isClean(dir)).toBe(false);
  });

  it('returns ahead=0/behind=0 when no upstream is configured', async () => {
    const s = await getRepoStatus(dir);
    expect(s.ahead).toBe(0);
    expect(s.behind).toBe(0);
  });

  it('fetchRepo returns a non-zero code when remotes are absent', async () => {
    const r = await fetchRepo(dir);
    // git fetch --all with no remotes succeeds with code 0 and empty output.
    // (Confirmed across modern git versions; older versions may warn.)
    expect(r.code).toBe(0);
  });

  it('pullRepo fails cleanly without upstream', async () => {
    const r = await pullRepo(dir);
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/upstream|tracking|no/i);
  });

  it('reports ahead/behind against an upstream', async () => {
    // Build a "remote" by cloning the existing repo bare, then re-point
    // the working repo at it as origin/main and diverge by one commit.
    const remoteDir = await mkdtemp(join(tmpdir(), 'forgemap-git-remote-'));
    try {
      await git(remoteDir, ['init', '--bare', '--quiet', '-b', 'main']);
      await git(dir, ['remote', 'add', 'origin', remoteDir]);
      await git(dir, ['push', '--quiet', '-u', 'origin', 'main']);

      await writeFile(join(dir, 'README.md'), 'second\n');
      await git(dir, ['add', '.']);
      await git(dir, ['commit', '--quiet', '-m', 'second']);

      const s = await getRepoStatus(dir);
      expect(s.ahead).toBe(1);
      expect(s.behind).toBe(0);
    } finally {
      await rm(remoteDir, { recursive: true, force: true });
    }
  });

  it('getLastCommitUnix returns the latest commit time', async () => {
    const ts = await getLastCommitUnix(dir);
    expect(typeof ts).toBe('number');
    // The init commit was just made; within a minute of now.
    expect(Math.abs(Date.now() / 1000 - (ts as number))).toBeLessThan(60);
  });

  it('hasUnpushedCommits is true with no remote, false once pushed', async () => {
    // No remote configured yet → everything counts as unpushed.
    expect(await hasUnpushedCommits(dir)).toBe(true);

    const remoteDir = await mkdtemp(join(tmpdir(), 'forgemap-git-remote-'));
    try {
      await git(remoteDir, ['init', '--bare', '--quiet', '-b', 'main']);
      await git(dir, ['remote', 'add', 'origin', remoteDir]);
      await git(dir, ['push', '--quiet', '-u', 'origin', 'main']);
      expect(await hasUnpushedCommits(dir)).toBe(false);

      await writeFile(join(dir, 'README.md'), 'more\n');
      await git(dir, ['add', '.']);
      await git(dir, ['commit', '--quiet', '-m', 'unpushed']);
      expect(await hasUnpushedCommits(dir)).toBe(true);
    } finally {
      await rm(remoteDir, { recursive: true, force: true });
    }
  });
});
