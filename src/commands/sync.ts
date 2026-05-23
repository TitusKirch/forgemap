import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { scanReposCached } from '../repos/cache.ts';
import { fetchRepo, isClean, pullRepo } from '../repos/git.ts';
import type { ScannedRepo } from '../repos/scan.ts';

interface SyncOutcome {
  repo: ScannedRepo;
  status: 'synced' | 'skipped' | 'failed';
  message?: string;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        await task(next);
      }
    }
  );
  await Promise.all(workers);
}

export const syncCommand = defineCommand({
  meta: {
    name: 'sync',
    description:
      'Run git fetch (or --pull) across every cloned repo, in parallel'
  },
  args: {
    pull: {
      type: 'boolean',
      description:
        'Pull --ff-only instead of fetch. Dirty working trees are skipped.',
      default: false
    },
    concurrency: {
      type: 'string',
      description: 'Number of parallel workers (default: 4)'
    },
    sequential: {
      type: 'boolean',
      description: 'Run one repo at a time (overrides --concurrency)',
      default: false
    },
    forge: {
      type: 'string',
      description: 'Restrict to a single forge alias'
    },
    query: {
      type: 'string',
      description: 'Fuzzy filter against <owner>/<repo>'
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
    const loaded = await loadForgeMapConfig({ configFile: args.config });
    const configDir = loaded.configFile
      ? dirname(loaded.configFile)
      : loaded.cwd;
    let repos = await scanReposCached({
      config: loaded.config,
      configDir,
      useCache: !args['no-cache']
    });

    if (args.forge) {
      repos = repos.filter((r) => r.forgeName === args.forge);
    }
    if (args.query) {
      const fuse = new Fuse(repos, {
        keys: ['slug', 'owner', 'repo'],
        threshold: 0.3,
        ignoreLocation: true
      });
      repos = fuse.search(args.query).map((r) => r.item);
    }

    if (repos.length === 0) {
      consola.info('Nothing to sync.');
      return;
    }

    const concurrency = args.sequential
      ? 1
      : args.concurrency
        ? Math.max(1, Number.parseInt(args.concurrency, 10))
        : 4;

    consola.info(
      `Syncing ${repos.length} repo(s) — ${args.pull ? 'pull' : 'fetch'}, concurrency ${concurrency}`
    );

    const outcomes: SyncOutcome[] = [];
    await runWithConcurrency(repos, concurrency, async (repo) => {
      try {
        if (args.pull && !(await isClean(repo.localPath))) {
          outcomes.push({
            repo,
            status: 'skipped',
            message: 'dirty working tree'
          });
          consola.warn(`${colors.dim(repo.slug)} — skipped (dirty)`);
          return;
        }
        const result = args.pull
          ? await pullRepo(repo.localPath)
          : await fetchRepo(repo.localPath);
        if (result.code === 0) {
          outcomes.push({ repo, status: 'synced' });
          consola.success(colors.dim(repo.slug));
        } else {
          const message = result.timedOut
            ? 'timed out (remote unreachable)'
            : (result.stderr || result.stdout).trim().split('\n')[0] ||
              `git exited with code ${result.code}`;
          outcomes.push({
            repo,
            status: 'failed',
            message
          });
          consola.fail(
            `${colors.dim(repo.slug)} — ${outcomes.at(-1)?.message}`
          );
        }
      } catch (error) {
        outcomes.push({
          repo,
          status: 'failed',
          message: (error as Error).message
        });
        consola.fail(`${colors.dim(repo.slug)} — ${(error as Error).message}`);
      }
    });

    const synced = outcomes.filter((o) => o.status === 'synced').length;
    const skipped = outcomes.filter((o) => o.status === 'skipped').length;
    const failed = outcomes.filter((o) => o.status === 'failed').length;
    consola.info(
      `Done — ${colors.green(`${synced} synced`)}, ${colors.yellow(`${skipped} skipped`)}, ${colors.red(`${failed} failed`)}`
    );
    if (failed > 0) {
      process.exitCode = 1;
    }
  }
});
