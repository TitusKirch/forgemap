import { execCapture, type CaptureResult } from '../utils/exec.ts';

export interface RepoStatus {
  branch: string;
  /** No upstream configured for the current branch. */
  detached: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  lastCommit: { sha: string; relativeDate: string } | null;
}

async function gitIn(cwd: string, args: string[]): Promise<CaptureResult> {
  return execCapture('git', args, { cwd });
}

export async function getRepoStatus(localPath: string): Promise<RepoStatus> {
  const status: RepoStatus = {
    branch: 'HEAD',
    detached: false,
    dirty: false,
    ahead: 0,
    behind: 0,
    lastCommit: null
  };

  const branchResult = await gitIn(localPath, ['branch', '--show-current']);
  status.branch = branchResult.stdout.trim() || 'HEAD';
  status.detached = !status.branch || status.branch === 'HEAD';

  const porcelain = await gitIn(localPath, ['status', '--porcelain']);
  status.dirty = porcelain.stdout.trim().length > 0;

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
  return gitIn(localPath, ['fetch', '--all', '--prune']);
}

export async function pullRepo(localPath: string): Promise<CaptureResult> {
  return gitIn(localPath, ['pull', '--ff-only']);
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
