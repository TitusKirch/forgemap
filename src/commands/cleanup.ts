import { rm, rmdir } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
import { resolveRoot } from '../utils/path.ts';
import { loadForgeMapConfig } from '../config/load.ts';
import type { ForgeType } from '../config/schema.ts';
import { getForgeAdapter } from '../forges/registry.ts';
import type { RemoteCheckInput, RemoteCheckResult } from '../forges/types.ts';
import { removeCachedRepo, scanReposCached } from '../repos/cache.ts';
import {
  getLastCommitUnix,
  getOriginUrl,
  getRepoStatus,
  hasUnpushedCommits,
  isGitRepo
} from '../repos/git.ts';
import type { ScannedRepo } from '../repos/scan.ts';
import { parseSlug } from '../slug/parse.ts';
import { mapLimit } from '../utils/concurrency.ts';

const DAY_SECONDS = 86_400;
const LOCAL_CONCURRENCY = 16;
const REMOTE_CONCURRENCY = 10;

/**
 * A stale repo that has an origin. `blocked` holds the reason it cannot be
 * deleted, or null while it is still a safe candidate. Carries the origin
 * identity used for the remote-existence check.
 */
interface Candidate {
  repo: ScannedRepo;
  origin: string;
  /** owner/repo parsed from origin (falls back to the folder identity). */
  owner: string;
  name: string;
  lastCommitUnix: number;
  blocked: string | null;
}

/**
 * Local gates (no network). Returns null for repos we ignore entirely:
 * non-git dirs, repos without an origin, and repos that are NOT stale (their
 * newest commit is within the cutoff). A stale repo with an origin is always
 * returned, with `blocked` set when it is dirty or has unpushed work — so the
 * caller can explain why it was kept.
 */
async function evaluate(
  repo: ScannedRepo,
  cutoffUnix: number
): Promise<Candidate | null> {
  if (!(await isGitRepo(repo.localPath))) return null;
  const origin = await getOriginUrl(repo.localPath);
  if (!origin) return null;

  const lastCommitUnix = await getLastCommitUnix(repo.localPath);
  if (lastCommitUnix === null || lastCommitUnix > cutoffUnix) return null;

  const status = await getRepoStatus(repo.localPath);
  let blocked: string | null = null;
  if (status.dirty) blocked = 'uncommitted changes';
  else if (await hasUnpushedCommits(repo.localPath))
    blocked = 'unpushed commits';

  let owner = repo.owner;
  let name = repo.repo;
  try {
    const parsed = parseSlug(origin);
    owner = parsed.owner;
    name = parsed.repo;
  } catch {
    // Unparseable origin — fall back to the folder identity.
  }

  return { repo, origin, owner, name, lastCommitUnix, blocked };
}

/** Check each candidate's remote, grouped by forge so GitHub can batch. */
async function classifyRemotes(
  candidates: Candidate[]
): Promise<Map<string, RemoteCheckResult>> {
  const byType = new Map<ForgeType, Candidate[]>();
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

function ageDays(lastCommitUnix: number): number {
  return Math.floor(
    Date.now() / 1000 / DAY_SECONDS - lastCommitUnix / DAY_SECONDS
  );
}

export const cleanupCommand = defineCommand({
  meta: {
    name: 'cleanup',
    description:
      'List stale, clean, fully-pushed repos whose remote still exists, then delete them locally after confirmation'
  },
  args: {
    days: {
      type: 'string',
      description: 'Minimum age in days since the last commit (default 365)',
      default: '365'
    },
    forge: {
      type: 'string',
      description: 'Restrict to a single forge alias'
    },
    'dry-run': {
      type: 'boolean',
      description: 'Only list candidates; never prompt or delete',
      default: false
    },
    yes: {
      type: 'boolean',
      description: 'Skip the interactive confirmation (deletes immediately)',
      default: false
    },
    'no-cache': {
      type: 'boolean',
      description: 'Skip the scanned-repos cache',
      default: false
    },
    config: {
      type: 'string',
      description: 'Path to forgemap.config.ts (overrides walk-up discovery)'
    }
  },
  async run({ args }) {
    const days = Number.parseInt(args.days, 10);
    if (!Number.isFinite(days) || days < 0) {
      consola.error(`Invalid --days value "${args.days}".`);
      process.exitCode = 1;
      return;
    }

    const loaded = await loadForgeMapConfig({ configFile: args.config });
    const configDir = loaded.configFile
      ? dirname(loaded.configFile)
      : loaded.cwd;
    let repos = await scanReposCached({
      config: loaded.config,
      configDir,
      useCache: !args['no-cache']
    });
    if (args.forge) repos = repos.filter((r) => r.forgeName === args.forge);

    const cutoffUnix = Math.floor(Date.now() / 1000) - days * DAY_SECONDS;

    // Stale repos that have an origin. (Recent repos and repos without an
    // origin are ignored entirely and never listed.)
    const stale = (
      await mapLimit(repos, LOCAL_CONCURRENCY, (repo) =>
        evaluate(repo, cutoffUnix)
      )
    ).filter((c): c is Candidate => c !== null);

    if (stale.length === 0) {
      consola.info(`No repo has been idle for ${days}+ days.`);
      return;
    }

    // Only the locally-safe ones (clean + pushed) need a remote check. Delete
    // only what is provably backed up: the remote must still exist (or have
    // moved — still backed up). gone/unreachable is never safe → kept.
    const checkable = stale.filter((c) => c.blocked === null);
    const remoteStates = await classifyRemotes(checkable);
    for (const c of checkable) {
      const state = remoteStates.get(c.repo.localPath)?.state;
      if (state === 'exists' || state === 'moved') continue;
      c.blocked =
        state === 'gone' ? 'remote no longer exists' : 'remote unreachable';
    }

    const candidates = stale
      .filter((c) => c.blocked === null)
      .sort((a, b) => a.lastCommitUnix - b.lastCommitUnix);
    const kept = stale
      .filter((c) => c.blocked !== null)
      .sort((a, b) => a.lastCommitUnix - b.lastCommitUnix);

    if (candidates.length > 0) {
      process.stdout.write(
        `${colors.bold(`${candidates.length} repo(s) eligible for cleanup`)} ${colors.dim(`(clean, pushed, idle ${days}+ days, remote exists)`)}\n\n`
      );
      for (const c of candidates) {
        process.stdout.write(
          `  ${colors.cyan(`${c.repo.forgeName}:${c.repo.slug}`)}  ${colors.dim(`${ageDays(c.lastCommitUnix)}d idle`)}  ${colors.dim(c.repo.localPath)}\n`
        );
      }
      process.stdout.write('\n');
    }

    // Explain why the other idle repos were spared.
    if (kept.length > 0) {
      process.stdout.write(
        `${colors.dim(`${kept.length} idle repo(s) kept (not safe to delete):`)}\n`
      );
      for (const c of kept) {
        process.stdout.write(
          `  ${colors.dim(`${c.repo.forgeName}:${c.repo.slug}  ${ageDays(c.lastCommitUnix)}d idle — ${c.blocked}`)}\n`
        );
      }
      process.stdout.write('\n');
    }

    if (candidates.length === 0) {
      consola.info('Nothing safe to delete.');
      return;
    }

    if (args['dry-run']) {
      consola.info('Dry run — nothing deleted.');
      return;
    }

    let confirmed = args.yes;
    if (!confirmed) {
      const answer = await consola.prompt(
        `Type "yes" to delete these ${candidates.length} repo(s) locally:`,
        { type: 'text', cancel: 'null' }
      );
      confirmed = typeof answer === 'string' && answer.trim() === 'yes';
    }
    if (!confirmed) {
      consola.info('Aborted — nothing deleted.');
      return;
    }

    const root = resolveRoot(loaded.config.root, configDir);
    for (const c of candidates) {
      await rm(c.repo.localPath, { recursive: true, force: true });
      await removeCachedRepo(
        { config: loaded.config, configDir },
        c.repo.localPath
      );
      // Remove the now-empty owner (and server-dir) directories left behind,
      // walking up but never past the configured root.
      await pruneEmptyParents(dirname(c.repo.localPath), root);
      consola.success(`Deleted ${c.repo.localPath}`);
    }
    consola.success(`Removed ${candidates.length} repo(s).`);
  }
});

/** rmdir empty ancestor dirs up to (but not including) `root`. */
async function pruneEmptyParents(start: string, root: string): Promise<void> {
  let dir = start;
  while (dir !== root && dir.startsWith(`${root}/`)) {
    try {
      await rmdir(dir); // fails (and we stop) if the dir is not empty
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}
