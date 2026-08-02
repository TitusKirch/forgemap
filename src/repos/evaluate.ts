import type { Dirent } from 'node:fs';
import { readdir, rmdir } from 'node:fs/promises';
import { join } from 'pathe';
import type { ForgeMapConfig, ForgeType } from '../config/schema.ts';
import { getForgeAdapter } from '../forges/registry.ts';
import type { RemoteCheckInput, RemoteCheckResult } from '../forges/types.ts';
import { parseSlug } from '../slug/parse.ts';
import { mapLimit } from '../utils/concurrency.ts';
import {
  getLastCommitUnix,
  getOriginUrl,
  getRepoStatus,
  hasUnpushedCommits,
  isGitRepo
} from './git.ts';
import { GIT_MARKER, MAX_SCAN_DEPTH } from './layout.ts';
import type { ScannedRepo } from './scan.ts';

const REMOTE_CONCURRENCY = 10;

/**
 * A deletion candidate: a git repo that has an origin. `dirty` / `unpushed` /
 * `stashes` record its local state; the gates below decide whether those block
 * deletion (overridable via flags) while a missing remote is always a hard stop.
 * Carries the origin identity used for the remote-existence check.
 *
 * Shared by `cleanup` (bulk, staleness-driven) and `delete` (targeted) so the
 * two commands cannot drift apart on what counts as safe to remove.
 */
export interface RepoEvaluation {
  repo: ScannedRepo;
  origin: string;
  /** owner/repo parsed from origin (falls back to the folder identity). */
  owner: string;
  name: string;
  /** Newest commit on a local branch; null when the repo has no commits. */
  lastCommitUnix: number | null;
  dirty: boolean;
  unpushed: boolean;
  /** Entries on the stash; deleting the repo destroys them. */
  stashes: number;
}

/** A `RepoEvaluation` that passed a staleness cutoff, so its last commit is known. */
export interface StaleRepoEvaluation extends RepoEvaluation {
  lastCommitUnix: number;
}

export interface EvaluateOptions {
  /**
   * Only return the repo when its newest local commit is at or before this
   * unix timestamp (and a repo with no commits at all is skipped). Omit to
   * evaluate regardless of age — `delete` targets one repo by name and has no
   * staleness requirement.
   */
  cutoffUnix?: number;
}

export async function evaluateRepo(
  repo: ScannedRepo,
  options: { cutoffUnix: number }
): Promise<StaleRepoEvaluation | null>;
export async function evaluateRepo(
  repo: ScannedRepo,
  options?: EvaluateOptions
): Promise<RepoEvaluation | null>;
/**
 * Local gates (no network). Returns null for repos we ignore entirely:
 * non-git dirs, repos without an origin, and — when `cutoffUnix` is given —
 * repos that are NOT stale (their newest local commit is within the cutoff).
 * Anything returned carries its dirty/unpushed/stashed state.
 */
export async function evaluateRepo(
  repo: ScannedRepo,
  options: EvaluateOptions = {}
): Promise<RepoEvaluation | null> {
  if (!(await isGitRepo(repo.localPath))) return null;
  const origin = await getOriginUrl(repo.localPath);
  if (!origin) return null;

  const lastCommitUnix = await getLastCommitUnix(repo.localPath);
  if (options.cutoffUnix !== undefined) {
    if (lastCommitUnix === null || lastCommitUnix > options.cutoffUnix) {
      return null;
    }
  }

  const status = await getRepoStatus(repo.localPath);
  const dirty = status.dirty;
  const stashes = status.stashes;
  const unpushed = await hasUnpushedCommits(repo.localPath);

  let owner = repo.owner;
  let name = repo.repo;
  try {
    const parsed = parseSlug(origin);
    owner = parsed.owner;
    name = parsed.repo;
  } catch {
    // Unparseable origin — fall back to the folder identity.
  }

  return {
    repo,
    origin,
    owner,
    name,
    lastCommitUnix,
    dirty,
    unpushed,
    stashes
  };
}

/** Which local-work gates the caller has explicitly opted to override. */
export interface GateOverrides {
  includeDirty: boolean;
  includeUnpushed: boolean;
  includeStashed: boolean;
}

const UNCOMMITTED = 'uncommitted changes';
const UNPUSHED = 'unpushed commits';
const STASHED = 'stashed work';

/** Stashes are separate work, so `--include-dirty` must not override them. */
function stashedReason(stashes: number): string {
  return `${STASHED} (${stashes} stash${stashes === 1 ? '' : 'es'})`;
}

/**
 * The flag that lets a caller override a local gate, or undefined for a gate
 * that cannot be overridden. Lives beside `localBlocker` so a gate and its
 * escape hatch cannot drift apart; `delete` reads it to tell the user which
 * flag would force the deletion through.
 *
 * A function rather than a lookup table because the stashed-work reason
 * carries its count, so it has no fixed key.
 */
export function localGateOverride(reason: string): string | undefined {
  if (reason === UNCOMMITTED) return '--include-dirty';
  if (reason === UNPUSHED) return '--include-unpushed';
  if (reason.startsWith(STASHED)) return '--include-stashed';
  return undefined;
}

/**
 * Why this repo must not be deleted on local grounds, or null when every
 * local gate passes. The single place `cleanup` and `delete` agree on what
 * counts as local work at risk — a new gate added here reaches both commands.
 */
export function localBlocker(
  evaluation: RepoEvaluation,
  overrides: GateOverrides
): string | null {
  if (evaluation.dirty && !overrides.includeDirty) return UNCOMMITTED;
  if (evaluation.unpushed && !overrides.includeUnpushed) return UNPUSHED;
  if (evaluation.stashes > 0 && !overrides.includeStashed) {
    return stashedReason(evaluation.stashes);
  }
  return null;
}

/**
 * Why the remote's state forbids deletion, or null when it is safe. A remote
 * that is gone or unreachable is ALWAYS a hard stop — no flag overrides it,
 * because the local copy may be the last one in existence.
 */
export function remoteBlocker(
  state: RemoteCheckResult['state'] | undefined
): string | null {
  if (state === 'exists' || state === 'moved') return null;
  return state === 'gone' ? 'remote no longer exists' : 'remote unreachable';
}

/** Check each candidate's remote, grouped by forge so GitHub can batch. */
export async function classifyRemotes(
  candidates: RepoEvaluation[]
): Promise<Map<string, RemoteCheckResult>> {
  const byType = new Map<ForgeType, RepoEvaluation[]>();
  for (const c of candidates) {
    const list = byType.get(c.repo.forge.type);
    if (list) list.push(c);
    else byType.set(c.repo.forge.type, [c]);
  }

  const results = new Map<string, RemoteCheckResult>();
  await Promise.all(
    Array.from(byType, async ([type, items]) => {
      const inputs: RemoteCheckInput[] = items.map((c) => ({
        forge: c.repo.forge,
        owner: c.owner,
        repo: c.name,
        originUrl: c.origin
      }));

      let adapter: ReturnType<typeof getForgeAdapter>;
      try {
        adapter = getForgeAdapter(type);
      } catch (error) {
        for (const c of items) {
          results.set(c.repo.localPath, {
            state: 'unknown',
            reason: (error as Error).message
          });
        }
        return;
      }

      let res: RemoteCheckResult[];
      if (adapter.checkRemotes) {
        try {
          res = await adapter.checkRemotes(inputs);
        } catch (error) {
          res = inputs.map(() => ({
            state: 'unknown',
            reason: (error as Error).message
          }));
        }
      } else if (adapter.checkRemote) {
        const check = adapter.checkRemote;
        res = await mapLimit(inputs, REMOTE_CONCURRENCY, async (inp) => {
          try {
            return await check(inp);
          } catch (error) {
            return { state: 'unknown', reason: (error as Error).message };
          }
        });
      } else {
        res = inputs.map(() => ({
          state: 'unknown',
          reason: `${type} has no remote check`
        }));
      }

      items.forEach((c, i) => results.set(c.repo.localPath, res[i]!));
    })
  );

  return results;
}

/**
 * Collect the empty namespace directories at and below `path`, deepest first,
 * and report whether `path` itself turned out to be one.
 *
 * A namespace is empty when it holds nothing, or holds only namespaces that
 * are themselves empty — which is what makes this follow a nested layout
 * rather than the single owner level it used to assume. The walk never enters
 * a repo: a `.git` entry means the directory is a checkout, and a checkout is
 * never a leftover however empty its subdirectories are.
 */
async function collectEmptyDirs(
  path: string,
  depth: number,
  empties: string[]
): Promise<boolean> {
  if (depth > MAX_SCAN_DEPTH) return false;
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some((e) => e.name === GIT_MARKER)) return false;
  if (entries.length === 0) {
    empties.push(path);
    return true;
  }
  // A file here is content, so the directory stays whatever its children are.
  if (entries.some((e) => !e.isDirectory())) return false;

  let allEmpty = true;
  for (const entry of entries) {
    const childEmpty = await collectEmptyDirs(
      join(path, entry.name),
      depth + 1,
      empties
    );
    if (!childEmpty) allEmpty = false;
  }
  if (allEmpty) empties.push(path);
  return allEmpty;
}

/** Empty namespace directories (server dir included) under the configured
 *  forge dirs, deepest first. Detection only — no removal. */
export async function findEmptyDirs(
  root: string,
  config: ForgeMapConfig
): Promise<string[]> {
  const empties: string[] = [];
  for (const forge of Object.values(config.forges)) {
    await collectEmptyDirs(join(root, forge.dir), 0, empties);
  }
  return empties;
}

/** Remove the dirs from findEmptyDirs (children before their parents). */
export async function pruneEmptyDirs(
  root: string,
  config: ForgeMapConfig
): Promise<number> {
  const empties = await findEmptyDirs(root, config);
  let removed = 0;
  for (const dir of empties) {
    try {
      await rmdir(dir);
      removed++;
    } catch {
      // Not actually empty (a file slipped in) — leave it.
    }
  }
  return removed;
}
