import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { removeCachedRepo } from '../repos/cache.ts';
import {
  classifyRemotes,
  evaluateRepo,
  localBlocker,
  localGateOverride,
  pruneEmptyDirs,
  remoteBlocker
} from '../repos/evaluate.ts';
import { getUnpushedBranches } from '../repos/git.ts';
import type { ScannedRepo } from '../repos/scan.ts';
import { parseSlug } from '../slug/parse.ts';
import { resolveSlug } from '../slug/resolve.ts';
import { resolveRoot } from '../utils/path.ts';

export const deleteCommand = defineCommand({
  meta: {
    name: 'delete',
    description:
      'Delete one local repo by slug, behind the same safety gates as cleanup (no staleness requirement)'
  },
  args: {
    slug: {
      type: 'positional',
      description: 'owner/repo, forge:owner/repo, or full URL',
      required: true
    },
    'dry-run': {
      type: 'boolean',
      description: 'Only report what would happen; never prompt or delete',
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
        'Also delete when there are uncommitted changes (those changes are lost)',
      default: false
    },
    'include-unpushed': {
      type: 'boolean',
      description:
        'Also delete when there are unpushed commits (those commits are lost)',
      default: false
    },
    'include-stashed': {
      type: 'boolean',
      description:
        'Also delete when there is stashed work (that stash is lost)',
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

    // Resolve the slug straight to a path: `delete` targets one repo by name,
    // so it never scans (and therefore never writes the scan cache).
    let resolved: ReturnType<typeof resolveSlug>;
    try {
      resolved = resolveSlug(parseSlug(args.slug), {
        config: loaded.config,
        configDir
      });
    } catch (error) {
      consola.error((error as Error).message);
      process.exitCode = 1;
      return;
    }

    const repo: ScannedRepo = {
      forgeName: resolved.forgeName,
      forge: resolved.forge,
      owner: resolved.owner,
      repo: resolved.repo,
      localPath: resolved.localPath,
      slug: `${resolved.owner}/${resolved.repo}`
    };

    if (!existsSync(repo.localPath)) {
      consola.error(
        `No local repo at ${repo.localPath} — nothing to delete for ${repo.forgeName}:${repo.slug}.`
      );
      process.exitCode = 1;
      return;
    }

    // Not a git repo, or a git repo with no origin: forgemap cannot prove the
    // contents exist anywhere else, so it will not remove them.
    const evaluation = await evaluateRepo(repo);
    if (!evaluation) {
      consola.error(
        `Refusing to delete ${colors.cyan(`${repo.forgeName}:${repo.slug}`)} — ${repo.localPath} is not a git repo with an "origin" remote, so there is no remote copy to fall back on. Remove it by hand if you are sure.`
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `${colors.bold(`${repo.forgeName}:${repo.slug}`)}  ${colors.dim(repo.localPath)}\n`
    );

    // Name the local-only work rather than reporting a bare boolean, so the
    // user can see exactly what deleting this repo would destroy.
    const unpushedBranches = evaluation.unpushed
      ? await getUnpushedBranches(repo.localPath)
      : [];
    const losses: string[] = [];
    if (evaluation.dirty) losses.push('uncommitted changes');
    if (evaluation.unpushed) {
      losses.push(
        unpushedBranches.length > 0
          ? `unpushed commits on ${unpushedBranches.join(', ')}`
          : 'unpushed commits'
      );
    }
    if (evaluation.stashes > 0) {
      losses.push(
        `${evaluation.stashes} stash${evaluation.stashes === 1 ? '' : 'es'}`
      );
    }
    if (losses.length > 0) {
      process.stdout.write(
        `  ${colors.red('local-only work:')} ${losses.join('; ')}\n`
      );
    }
    process.stdout.write('\n');

    // A gone/unreachable remote is checked and reported first: it is the one
    // gate no flag can override, so nothing else about the repo matters.
    const remoteStates = await classifyRemotes([evaluation]);
    const remoteReason = remoteBlocker(remoteStates.get(repo.localPath)?.state);
    if (remoteReason) {
      consola.error(
        `Refusing to delete — ${remoteReason}. This is never overridable: the local copy may be the only one left.`
      );
      process.exitCode = 1;
      return;
    }

    const localReason = localBlocker(evaluation, {
      includeDirty: Boolean(args['include-dirty']),
      includeUnpushed: Boolean(args['include-unpushed']),
      includeStashed: Boolean(args['include-stashed'])
    });
    if (localReason) {
      const hint = localGateOverride(localReason);
      consola.error(
        `Refusing to delete — ${localReason}${hint ? `. Pass ${hint} to delete anyway (that work is lost)` : ''}.`
      );
      process.exitCode = 1;
      return;
    }

    if (args['dry-run']) {
      consola.info('Dry run — nothing deleted.');
      return;
    }

    if (losses.length > 0) {
      consola.warn(
        `This repo has local-only work that will be permanently lost: ${losses.join('; ')}.`
      );
    }

    // Deletion always requires the literal "yes"; --yes is the only bypass.
    let confirmed = args.yes;
    if (!confirmed) {
      const answer = await consola.prompt(
        `Type "yes" to delete ${repo.slug} locally:`,
        { type: 'text', cancel: 'null' }
      );
      confirmed = typeof answer === 'string' && answer.trim() === 'yes';
    }
    if (!confirmed) {
      consola.info('Aborted — nothing deleted.');
      return;
    }

    await rm(repo.localPath, { recursive: true, force: true });
    await removeCachedRepo(
      { config: loaded.config, configDir },
      repo.localPath
    );
    consola.success(`Deleted ${repo.localPath}`);

    const root = resolveRoot(loaded.config.root, configDir);
    const emptied = await pruneEmptyDirs(root, loaded.config);
    if (emptied > 0) {
      consola.success(`Removed ${emptied} empty folder(s).`);
    }
  }
});
