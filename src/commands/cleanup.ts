import { readdir, rm, rmdir } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname, join } from 'pathe';
import { resolveRoot } from '../utils/path.ts';
import { loadForgeMapConfig } from '../config/load.ts';
import type { ForgeMapConfig, ForgeType } from '../config/schema.ts';
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
 * A stale repo that has an origin. `dirty` / `unpushed` / `stashed` record its
 * local state; the run logic decides whether those block deletion (overridable
 * via flags) while a missing remote is always a hard stop. Carries the origin
 * identity used for the remote-existence check.
 */
interface Candidate {
  repo: ScannedRepo;
  origin: string;
  /** owner/repo parsed from origin (falls back to the folder identity). */
  owner: string;
  name: string;
  lastCommitUnix: number;
  dirty: boolean;
  unpushed: boolean;
  /** Entries on the stash; deleting the repo destroys them. */
  stashes: number;
}

/**
 * Local gates (no network). Returns null for repos we ignore entirely:
 * non-git dirs, repos without an origin, and repos that are NOT stale (their
 * newest local commit is within the cutoff). A stale repo with an origin is
 * always returned with its dirty/unpushed state recorded.
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
    'include-dirty': {
      type: 'boolean',
      description:
        'Also delete repos with uncommitted changes (those changes are lost)',
      default: false
    },
    'include-unpushed': {
      type: 'boolean',
      description:
        'Also delete repos with unpushed commits (those commits are lost)',
      default: false
    },
    'include-stashed': {
      type: 'boolean',
      description: 'Also delete repos with stashed work (that stash is lost)',
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

    const includeDirty = Boolean(args['include-dirty']);
    const includeUnpushed = Boolean(args['include-unpushed']);
    const includeStashed = Boolean(args['include-stashed']);

    // Dirty / unpushed / stashed only block when the matching --include flag
    // is off. A missing remote is ALWAYS a hard stop (never overridable). So
    // only the locally-eligible repos need a remote check.
    const localOk = (c: Candidate) =>
      (!c.dirty || includeDirty) &&
      (!c.unpushed || includeUnpushed) &&
      (c.stashes === 0 || includeStashed);
    const remoteStates = await classifyRemotes(stale.filter(localOk));

    const candidates: Candidate[] = [];
    const kept: Array<{ repo: Candidate; reason: string }> = [];
    for (const c of stale) {
      if (c.dirty && !includeDirty) {
        kept.push({ repo: c, reason: 'uncommitted changes' });
      } else if (c.unpushed && !includeUnpushed) {
        kept.push({ repo: c, reason: 'unpushed commits' });
      } else if (c.stashes > 0 && !includeStashed) {
        kept.push({
          repo: c,
          reason: `stashed work (${c.stashes} stash${c.stashes === 1 ? '' : 'es'})`
        });
      } else {
        const state = remoteStates.get(c.repo.localPath)?.state;
        if (state === 'exists' || state === 'moved') candidates.push(c);
        else {
          kept.push({
            repo: c,
            reason:
              state === 'gone'
                ? 'remote no longer exists'
                : 'remote unreachable'
          });
        }
      }
    }
    candidates.sort((a, b) => a.lastCommitUnix - b.lastCommitUnix);
    kept.sort((a, b) => a.repo.lastCommitUnix - b.repo.lastCommitUnix);

    if (candidates.length > 0) {
      process.stdout.write(
        `${colors.bold(`${candidates.length} repo(s) eligible for cleanup`)} ${colors.dim(`(idle ${days}+ days, remote exists)`)}\n\n`
      );
      for (const c of candidates) {
        const flags = [
          c.dirty ? colors.red('dirty') : '',
          c.unpushed ? colors.red('unpushed') : '',
          c.stashes > 0 ? colors.red(`stashed:${c.stashes}`) : ''
        ]
          .filter(Boolean)
          .join(' ');
        process.stdout.write(
          `  ${colors.cyan(`${c.repo.forgeName}:${c.repo.slug}`)}  ${colors.dim(`${ageDays(c.lastCommitUnix)}d idle`)}${flags ? `  ${flags}` : ''}  ${colors.dim(c.repo.localPath)}\n`
        );
      }
      process.stdout.write('\n');
    }

    // Explain why the other idle repos were spared.
    if (kept.length > 0) {
      process.stdout.write(
        `${colors.dim(`${kept.length} idle repo(s) kept (not safe to delete):`)}\n`
      );
      for (const k of kept) {
        process.stdout.write(
          `  ${colors.dim(`${k.repo.repo.forgeName}:${k.repo.repo.slug}  ${ageDays(k.repo.lastCommitUnix)}d idle — ${k.reason}`)}\n`
        );
      }
      process.stdout.write('\n');
    }

    const root = resolveRoot(loaded.config.root, configDir);

    // Empty owner/server directories (e.g. left behind by earlier deletions)
    // are tidied on every run — they hold no files, so this is non-destructive.
    if (args['dry-run']) {
      const empties = await findEmptyDirs(root, loaded.config);
      if (empties.length > 0) {
        process.stdout.write(
          `${colors.dim(`${empties.length} empty folder(s) would be removed:`)}\n`
        );
        for (const e of empties) {
          process.stdout.write(`  ${colors.dim(e)}\n`);
        }
        process.stdout.write('\n');
      }
      consola.info(
        candidates.length > 0
          ? 'Dry run — nothing deleted.'
          : 'Nothing to delete.'
      );
      return;
    }

    if (candidates.length > 0) {
      // Loud warning when --include flags put real work on the chopping block.
      const losing = candidates.filter(
        (c) => c.dirty || c.unpushed || c.stashes > 0
      ).length;
      if (losing > 0) {
        consola.warn(
          `${losing} of these have uncommitted/unpushed/stashed work that will be permanently lost.`
        );
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

      for (const c of candidates) {
        await rm(c.repo.localPath, { recursive: true, force: true });
        await removeCachedRepo(
          { config: loaded.config, configDir },
          c.repo.localPath
        );
        consola.success(`Deleted ${c.repo.localPath}`);
      }
      consola.success(`Removed ${candidates.length} repo(s).`);
    }

    // Sweep empty owner/server dirs (pre-existing + newly emptied by deletes).
    const emptied = await pruneEmptyDirs(root, loaded.config);
    if (emptied > 0) {
      consola.success(`Removed ${emptied} empty folder(s).`);
    } else if (candidates.length === 0) {
      consola.info('Nothing to clean up.');
    }
  }
});

async function safeReaddir(path: string): Promise<string[] | null> {
  try {
    return await readdir(path);
  } catch {
    return null;
  }
}

/** Empty owner directories (and a server directory that holds only such empty
 *  owners) under the configured forge dirs. Detection only — no removal. */
async function findEmptyDirs(
  root: string,
  config: ForgeMapConfig
): Promise<string[]> {
  const empties: string[] = [];
  for (const forge of Object.values(config.forges)) {
    const serverPath = join(root, forge.dir);
    const owners = await safeReaddir(serverPath);
    if (owners === null) continue;
    let emptyCount = 0;
    for (const owner of owners) {
      const ownerPath = join(serverPath, owner);
      const inner = await safeReaddir(ownerPath);
      if (inner !== null && inner.length === 0) {
        empties.push(ownerPath);
        emptyCount++;
      }
    }
    // The server dir itself goes if it is empty or holds only empty owners.
    if (owners.length === 0 || emptyCount === owners.length) {
      empties.push(serverPath);
    }
  }
  return empties;
}

/** Remove the dirs from findEmptyDirs (owners before server dirs). */
async function pruneEmptyDirs(
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
