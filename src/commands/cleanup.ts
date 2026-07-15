import { rm } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
import { resolveRoot } from '../utils/path.ts';
import { loadForgeMapConfig } from '../config/load.ts';
import { removeCachedRepo, scanReposCached } from '../repos/cache.ts';
import {
  classifyRemotes,
  evaluateRepo,
  findEmptyDirs,
  localBlocker,
  pruneEmptyDirs,
  remoteBlocker,
  type StaleRepoEvaluation
} from '../repos/evaluate.ts';
import { mapLimit } from '../utils/concurrency.ts';

const DAY_SECONDS = 86_400;
const LOCAL_CONCURRENCY = 16;

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
        evaluateRepo(repo, { cutoffUnix })
      )
    ).filter((c): c is StaleRepoEvaluation => c !== null);

    const includeDirty = Boolean(args['include-dirty']);
    const includeUnpushed = Boolean(args['include-unpushed']);
    const includeStashed = Boolean(args['include-stashed']);
    const overrides = { includeDirty, includeUnpushed, includeStashed };

    // Dirty / unpushed / stashed only block when the matching --include flag
    // is off. A missing remote is ALWAYS a hard stop (never overridable). So
    // only the locally-eligible repos need a remote check.
    const remoteStates = await classifyRemotes(
      stale.filter((c) => localBlocker(c, overrides) === null)
    );

    const candidates: StaleRepoEvaluation[] = [];
    const kept: Array<{ repo: StaleRepoEvaluation; reason: string }> = [];
    for (const c of stale) {
      const reason =
        localBlocker(c, overrides) ??
        remoteBlocker(remoteStates.get(c.repo.localPath)?.state);
      if (reason === null) candidates.push(c);
      else kept.push({ repo: c, reason });
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
