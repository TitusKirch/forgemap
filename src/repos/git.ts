import { execCapture, type CaptureResult } from '../utils/exec.ts';

export interface RepoStatus {
  branch: string;
  /** No upstream configured for the current branch. */
  detached: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  /** Entries on `refs/stash` — local work no other field reports. */
  stashes: number;
  lastCommit: { sha: string; relativeDate: string } | null;
}

async function gitIn(cwd: string, args: string[]): Promise<CaptureResult> {
  return execCapture('git', args, { cwd });
}

/** Network git ops (fetch/pull) must never block: force non-interactive SSH
 *  and a hard timeout so an unreachable or auth-prompting remote can't wedge
 *  a whole `sync` run. */
const NETWORK_TIMEOUT_MS = 30_000;

async function gitNetwork(cwd: string, args: string[]): Promise<CaptureResult> {
  return execCapture('git', args, {
    cwd,
    timeoutMs: NETWORK_TIMEOUT_MS,
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=5'
    }
  });
}

export async function getRepoStatus(localPath: string): Promise<RepoStatus> {
  const status: RepoStatus = {
    branch: 'HEAD',
    detached: false,
    dirty: false,
    ahead: 0,
    behind: 0,
    stashes: 0,
    lastCommit: null
  };

  const branchResult = await gitIn(localPath, ['branch', '--show-current']);
  status.branch = branchResult.stdout.trim() || 'HEAD';
  status.detached = !status.branch || status.branch === 'HEAD';

  const porcelain = await gitIn(localPath, ['status', '--porcelain']);
  status.dirty = porcelain.stdout.trim().length > 0;

  status.stashes = await countStashes(localPath);

  // ahead/behind only meaningful with an upstream
  const aheadBehind = await gitIn(localPath, [
    'rev-list',
    '--left-right',
    '--count',
    '@{u}...HEAD'
  ]);
  if (aheadBehind.code === 0) {
    const match = aheadBehind.stdout.trim().match(/^(\d+)\s+(\d+)$/);
    if (match) {
      status.behind = Number(match[1]);
      status.ahead = Number(match[2]);
    }
  }

  const lastCommit = await gitIn(localPath, ['log', '-1', '--format=%h|%cr']);
  if (lastCommit.code === 0) {
    const [sha, relativeDate] = lastCommit.stdout.trim().split('|');
    if (sha && relativeDate) {
      status.lastCommit = { sha, relativeDate };
    }
  }

  return status;
}

export async function fetchRepo(localPath: string): Promise<CaptureResult> {
  return gitNetwork(localPath, ['fetch', '--all', '--prune']);
}

export async function pullRepo(localPath: string): Promise<CaptureResult> {
  return gitNetwork(localPath, ['pull', '--ff-only']);
}

export async function isClean(localPath: string): Promise<boolean> {
  const result = await gitIn(localPath, ['status', '--porcelain']);
  return result.code === 0 && result.stdout.trim().length === 0;
}

export interface GitRemote {
  name: string;
  url: string;
}

/** True if `localPath` is inside a git work tree. */
export async function isGitRepo(localPath: string): Promise<boolean> {
  const result = await gitIn(localPath, ['rev-parse', '--is-inside-work-tree']);
  return result.code === 0 && result.stdout.trim() === 'true';
}

/** The `origin` remote URL, or null when there is no `origin`. */
export async function getOriginUrl(localPath: string): Promise<string | null> {
  const result = await gitIn(localPath, ['remote', 'get-url', 'origin']);
  if (result.code !== 0) return null;
  const url = result.stdout.trim();
  return url.length > 0 ? url : null;
}

/** Every configured remote with a URL, in config order. */
export async function getRemotes(localPath: string): Promise<GitRemote[]> {
  const result = await gitIn(localPath, [
    'config',
    '--get-regexp',
    '^remote\\..*\\.url$'
  ]);
  if (result.code !== 0) return [];
  const remotes: GitRemote[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^remote\.(.+)\.url\s+(.+)$/);
    if (match) remotes.push({ name: match[1]!, url: match[2]! });
  }
  return remotes;
}

/** Repoint `origin` at a new URL. Used by `import --fix`. */
export async function setOriginUrl(
  localPath: string,
  url: string
): Promise<CaptureResult> {
  return gitIn(localPath, ['remote', 'set-url', 'origin', url]);
}

/** Unix timestamp (seconds) of the most recent commit on a LOCAL branch, or
 *  null when there are no commits. Excludes remote-tracking refs on purpose:
 *  a recent `fetch` must not make a long-idle local checkout look fresh.
 *  Drives the staleness check in `cleanup`. */
export async function getLastCommitUnix(
  localPath: string
): Promise<number | null> {
  const result = await gitIn(localPath, [
    'log',
    '--branches',
    '-1',
    '--format=%ct'
  ]);
  if (result.code !== 0) return null;
  const ts = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(ts) ? ts : null;
}

/**
 * True when any commit on any local branch is not reachable from a remote
 * tracking ref — i.e. there is work that exists only locally. Conservative
 * by design: with no remotes configured, everything counts as unpushed.
 */
export async function hasUnpushedCommits(localPath: string): Promise<boolean> {
  const result = await gitIn(localPath, [
    'log',
    '--branches',
    '--not',
    '--remotes',
    '--format=%H',
    '-1'
  ]);
  if (result.code !== 0) return true;
  return result.stdout.trim().length > 0;
}

/**
 * Number of entries on the stash. Stashed work is invisible to every other
 * local check: `git status --porcelain` reports no working-tree change once
 * the stash is taken, and stash commits live on `refs/stash`, so
 * `git log --branches` (staleness) and `--branches --not --remotes`
 * (unpushed) skip them too. A repo whose only local work is stashed therefore
 * looks clean, idle and fully pushed unless this is checked explicitly.
 *
 * `%gd` prints one bare `stash@{n}` per entry, so a stash message containing
 * a newline cannot inflate the count. Returns 0 when the stash is unreadable
 * (e.g. not a git repo) — callers gate on `isGitRepo` first.
 */
export async function countStashes(localPath: string): Promise<number> {
  const result = await gitIn(localPath, ['stash', 'list', '--format=%gd']);
  if (result.code !== 0) return 0;
  return result.stdout.split('\n').filter((line) => line.trim().length > 0)
    .length;
}

/** True when the repo has any stashed work. See {@link countStashes}. */
export async function hasStashes(localPath: string): Promise<boolean> {
  return (await countStashes(localPath)) > 0;
}
