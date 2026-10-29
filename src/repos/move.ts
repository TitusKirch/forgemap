import { existsSync } from 'node:fs';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'pathe';
import type { ForgeMapConfig } from '../config/schema.ts';
import { parseSlug } from '../slug/parse.ts';
import { type ResolvedSlug, resolveSlug } from '../slug/resolve.ts';
import { mapLimit } from '../utils/concurrency.ts';
import { execCapture } from '../utils/exec.ts';
import { classifyRemotes } from './evaluate.ts';
import { getOriginUrl, setOriginUrl } from './git.ts';
import { GIT_MARKER } from './layout.ts';
import type { ScannedRepo } from './scan.ts';

export interface MovePlan {
  repo: ScannedRepo;
  /** The repo as it will be scanned once it sits at its new location. */
  target: ScannedRepo;
  origin: string;
  /** Set when the forge reports the remote moved: origin is repointed too. */
  newOrigin?: string;
}

export type MoveCheck =
  | { kind: 'move'; plan: MovePlan }
  /** Folder already matches origin — nothing to do. */
  | { kind: 'in-place'; repo: ScannedRepo }
  /** A linked worktree: named by whoever added it, never by origin. */
  | { kind: 'worktree'; repo: ScannedRepo }
  | { kind: 'skip'; repo: ScannedRepo; reason: string };

export interface PlanMovesOptions {
  config: ForgeMapConfig;
  configDir: string;
  /** Ask the forge whether the remote itself moved. */
  remoteCheck: boolean;
}

const LOCAL_CONCURRENCY = 16;

function toScanned(resolved: ResolvedSlug): ScannedRepo {
  return {
    forgeName: resolved.forgeName,
    forge: resolved.forge,
    owner: resolved.owner,
    repo: resolved.repo,
    localPath: resolved.localPath,
    slug: `${resolved.owner}/${resolved.repo}`
  };
}

/**
 * Swap the `<namespace…>/<repo>` part of a remote URL, keeping everything
 * else — scheme, user, host and a `.git` suffix. The forges report a moved
 * remote as an https URL; taking it verbatim would silently turn an ssh
 * checkout into an https one.
 */
export function rewriteOriginPath(
  origin: string,
  owner: string,
  repo: string
): string {
  const suffix = origin.endsWith('.git') ? '.git' : '';
  const ssh = /^(git@[^:]+:)/.exec(origin);
  if (ssh) return `${ssh[1]}${owner}/${repo}${suffix}`;
  const url = new URL(origin);
  url.pathname = `/${owner}/${repo}${suffix}`;
  return url.toString();
}

/**
 * A linked worktree has a `.git` *file* pointing into the main repo's
 * `worktrees/`. Its origin is the main repo's, so following it would try to
 * move every worktree onto the checkout it was branched from.
 */
async function isLinkedWorktree(localPath: string): Promise<boolean> {
  try {
    const pointer = await readFile(join(localPath, GIT_MARKER), 'utf8');
    return /^gitdir: .*[/\\]worktrees[/\\]/m.test(pointer);
  } catch {
    return false; // a `.git` directory — an ordinary checkout
  }
}

type Located =
  | { kind: 'worktree'; repo: ScannedRepo }
  | { kind: 'skip'; repo: ScannedRepo; reason: string }
  | {
      kind: 'located';
      repo: ScannedRepo;
      origin: string;
      resolved: ResolvedSlug;
    };

async function locateByOrigin(
  repo: ScannedRepo,
  options: PlanMovesOptions
): Promise<Located> {
  if (await isLinkedWorktree(repo.localPath)) return { kind: 'worktree', repo };
  const origin = await getOriginUrl(repo.localPath);
  if (!origin) return { kind: 'skip', repo, reason: 'no origin remote' };
  try {
    const resolved = resolveSlug(parseSlug(origin), options);
    return { kind: 'located', repo, origin, resolved };
  } catch (error) {
    return { kind: 'skip', repo, reason: (error as Error).message };
  }
}

function finalize(
  located: Extract<Located, { kind: 'located' }>,
  target: ResolvedSlug,
  newOrigin: string | undefined
): MoveCheck {
  const { repo, origin } = located;
  const to = target.localPath;
  if (to === repo.localPath && !newOrigin) return { kind: 'in-place', repo };
  if (to !== repo.localPath) {
    if (to.startsWith(`${repo.localPath}/`)) {
      return {
        kind: 'skip',
        repo,
        reason: `target ${to} lies inside the repo`
      };
    }
    if (existsSync(to)) {
      return { kind: 'skip', repo, reason: `target already exists: ${to}` };
    }
  }
  return {
    kind: 'move',
    plan: { repo, target: toScanned(target), origin, newOrigin }
  };
}

/**
 * Work out where each repo belongs: the location its `origin` names, or —
 * with `remoteCheck` — the location the forge says the remote moved to.
 * Detection only; {@link applyMove} does the work.
 */
export async function planMoves(
  repos: ScannedRepo[],
  options: PlanMovesOptions
): Promise<MoveCheck[]> {
  const located = await mapLimit(repos, LOCAL_CONCURRENCY, (repo) =>
    locateByOrigin(repo, options)
  );

  const checkable = located.filter(
    (l): l is Extract<Located, { kind: 'located' }> => l.kind === 'located'
  );
  // The forge the origin points at is the one to ask — not the one the folder
  // currently sits under, which is exactly what may be wrong.
  const remotes = options.remoteCheck
    ? await classifyRemotes(
        checkable.map((l) => ({
          repo: { ...l.repo, forge: l.resolved.forge },
          origin: l.origin,
          owner: l.resolved.owner,
          name: l.resolved.repo
        }))
      )
    : new Map();

  return located.map((l) => {
    if (l.kind !== 'located') return l;
    const remote = remotes.get(l.repo.localPath);
    if (remote?.state !== 'moved') return finalize(l, l.resolved, undefined);
    const { owner, repo } = remote.canonical;
    let target: ResolvedSlug;
    try {
      target = resolveSlug(
        { forgeName: l.resolved.forgeName, owner, repo },
        options
      );
    } catch (error) {
      return { kind: 'skip', repo: l.repo, reason: (error as Error).message };
    }
    return finalize(l, target, rewriteOriginPath(l.origin, owner, repo));
  });
}

/**
 * Repoint origin (when the remote moved) and move the folder. Linked
 * worktrees record absolute paths in both directions, so `git worktree
 * repair` runs at the new location — a no-op for a plain checkout.
 */
export async function applyMove(plan: MovePlan): Promise<void> {
  const from = plan.repo.localPath;
  const to = plan.target.localPath;
  if (plan.newOrigin) {
    const result = await setOriginUrl(from, plan.newOrigin);
    if (result.code !== 0) {
      throw new Error(
        `failed to set origin for ${from}: ${result.stderr.trim()}`
      );
    }
  }
  if (from === to) return;
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  await execCapture('git', ['worktree', 'repair'], { cwd: to });
}
