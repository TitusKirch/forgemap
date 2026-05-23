import { rm } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
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

/** A repo that passed every local safety gate; carries the origin identity
 *  used for the remote-existence check. */
interface Candidate {
  repo: ScannedRepo;
  origin: string;
  /** owner/repo parsed from origin (falls back to the folder identity). */
  owner: string;
  name: string;
  lastCommitUnix: number;
}

/**
 * Local gates (no network): must be a git repo, have an origin, be clean
 * (no uncommitted changes), have nothing unpushed, and have its newest commit
 * older than the cutoff. Repos without an origin are ignored entirely.
 */
async function localCandidate(
  repo: ScannedRepo,
  cutoffUnix: number
): Promise<Candidate | null> {
  if (!(await isGitRepo(repo.localPath))) return null;
  const origin = await getOriginUrl(repo.localPath);
  if (!origin) return null;

  const status = await getRepoStatus(repo.localPath);
  if (status.dirty) return null;
  if (await hasUnpushedCommits(repo.localPath)) return null;

  const lastCommitUnix = await getLastCommitUnix(repo.localPath);
  if (lastCommitUnix === null || lastCommitUnix > cutoffUnix) return null;

  let owner = repo.owner;
  let name = repo.repo;
  try {
    const parsed = parseSlug(origin);
    owner = parsed.owner;
    name = parsed.repo;
  } catch {
    // Unparseable origin — fall back to the folder identity.
  }

  return { repo, origin, owner, name, lastCommitUnix };
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

    const local = (
      await mapLimit(repos, LOCAL_CONCURRENCY, (repo) =>
        localCandidate(repo, cutoffUnix)
      )
    ).filter((c): c is Candidate => c !== null);

    if (local.length === 0) {
      consola.info('Nothing to clean up.');
      return;
    }

    // Only delete what is provably backed up: the remote must still exist
    // (or have moved — still backed up). gone/unknown (e.g. unreachable) is
    // never safe, so those repos are kept.
    const remoteStates = await classifyRemotes(local);
    const candidates = local.filter((c) => {
      const state = remoteStates.get(c.repo.localPath)?.state;
      return state === 'exists' || state === 'moved';
    });

    if (candidates.length === 0) {
      consola.info(
        'No safe candidates: stale repos were found, but none have a confirmed existing remote.'
      );
      return;
    }

    candidates.sort((a, b) => a.lastCommitUnix - b.lastCommitUnix);

    process.stdout.write(
      `${colors.bold(`${candidates.length} repo(s) eligible for cleanup`)} ${colors.dim(`(clean, pushed, no commit in ${days}+ days, remote exists)`)}\n\n`
    );
    for (const c of candidates) {
      process.stdout.write(
        `  ${colors.cyan(`${c.repo.forgeName}:${c.repo.slug}`)}  ${colors.dim(`${ageDays(c.lastCommitUnix)}d idle`)}  ${colors.dim(c.repo.localPath)}\n`
      );
    }
    process.stdout.write('\n');

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
});
