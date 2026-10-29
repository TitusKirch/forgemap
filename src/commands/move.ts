import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
import { type AgentMigration, migrateAgentState } from '../agents/index.ts';
import { loadForgeMapConfig } from '../config/load.ts';
import {
  appendCachedRepo,
  removeCachedRepo,
  scanReposCached
} from '../repos/cache.ts';
import { pruneEmptyDirs } from '../repos/evaluate.ts';
import { applyMove, type MoveCheck, planMoves } from '../repos/move.ts';
import { canPrompt } from '../repos/picker.ts';
import type { ScannedRepo } from '../repos/scan.ts';
import { resolveRepoPath } from '../slug/locate.ts';
import { resolveRoot } from '../utils/path.ts';

function label(repo: ScannedRepo): string {
  return `${repo.forgeName}:${repo.slug}`;
}

function renderCheck(check: MoveCheck): string {
  if (check.kind === 'move') {
    const { plan } = check;
    const lines = [
      `${colors.cyan(label(plan.repo))} → ${colors.green(label(plan.target))}`,
      `  ${colors.dim(`${plan.repo.localPath} → ${plan.target.localPath}`)}`
    ];
    if (plan.newOrigin) {
      lines.push(
        `  ${colors.yellow('remote moved')} ${colors.dim(`origin → ${plan.newOrigin}`)}`
      );
    }
    return lines.join('\n');
  }
  if (check.kind === 'skip') {
    return `${colors.yellow('!')} ${colors.cyan(label(check.repo))}  ${colors.dim(check.reason)}`;
  }
  if (check.kind === 'worktree') {
    return `${colors.dim('–')} ${colors.cyan(label(check.repo))}  ${colors.dim('linked worktree — not moved by origin')}`;
  }
  return `${colors.green('✓')} ${colors.cyan(label(check.repo))}  ${colors.dim('already where origin points')}`;
}

function renderAgents(results: AgentMigration[]): string {
  const lines: string[] = [];
  for (const { tool, changes, warnings } of results) {
    if (changes.length === 0 && warnings.length === 0) continue;
    lines.push(`  ${colors.bold(tool)}`);
    for (const change of changes) lines.push(`    ${colors.dim(change)}`);
    for (const warning of warnings) {
      lines.push(`    ${colors.yellow('!')} ${warning}`);
    }
  }
  return lines.length > 0
    ? lines.join('\n')
    : `  ${colors.dim('no agent state recorded for this path')}`;
}

/** The scanned repo the current directory sits in, if any. */
function repoAtCwd(repos: ScannedRepo[]): ScannedRepo | undefined {
  const cwd = process.cwd();
  return repos.find(
    (r) => cwd === r.localPath || cwd.startsWith(`${r.localPath}/`)
  );
}

export const moveCommand = defineCommand({
  meta: {
    name: 'move',
    description:
      'Move a repo to where its origin points — after a rename, a transfer, or an origin you repointed by hand'
  },
  args: {
    repo: {
      type: 'positional',
      description:
        'Repo to move: slug or fuzzy query (default: the repo you are in)',
      required: false
    },
    all: {
      type: 'boolean',
      description: 'Move every repo whose folder does not match its origin',
      default: false
    },
    'remote-check': {
      type: 'boolean',
      description:
        'Ask the forge whether the remote moved, and repoint origin too',
      negativeDescription: 'Only follow the origin URL as configured locally',
      default: true
    },
    agents: {
      type: 'boolean',
      description:
        'Carry Claude Code and Codex session state along, so resume keeps working',
      default: false
    },
    'dry-run': {
      type: 'boolean',
      description: 'Only report what would happen; never prompt or move',
      default: false
    },
    yes: {
      type: 'boolean',
      description: 'Skip the confirmation for --all',
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
    const context = { config: loaded.config, configDir };

    if (args.all && args.repo) {
      consola.error('Pass either a repo or --all, not both.');
      process.exitCode = 1;
      return;
    }

    // A fresh scan: a stale cache could still list a repo at a path an earlier
    // move already vacated.
    const repos = await scanReposCached({ ...context, useCache: false });

    let selected: ScannedRepo[];
    if (args.all) {
      selected = repos;
    } else if (args.repo) {
      const path = await resolveRepoPath(args.repo, {
        ...context,
        repos,
        cloned: true
      });
      const repo = path ? repos.find((r) => r.localPath === path) : undefined;
      if (!repo) {
        process.exitCode = 1;
        return;
      }
      selected = [repo];
    } else {
      const repo = repoAtCwd(repos);
      if (!repo) {
        consola.error(
          'Not inside a cloned repo. Name one, or pass --all to check them all.'
        );
        process.exitCode = 1;
        return;
      }
      selected = [repo];
    }

    const checks = await planMoves(selected, {
      ...context,
      remoteCheck: args['remote-check']
    });
    // With --all, repos already in place — and worktrees, which are never
    // moved — are the bulk of the tree and only noise; a single named repo
    // reports whatever it turned out to be.
    const shown = args.all
      ? checks.filter((c) => c.kind !== 'in-place' && c.kind !== 'worktree')
      : checks;
    for (const check of shown) process.stdout.write(`${renderCheck(check)}\n`);

    const moves = checks.flatMap((c) => (c.kind === 'move' ? [c.plan] : []));
    if (!args.all && checks.some((c) => c.kind === 'skip')) {
      process.exitCode = 1;
    }
    if (moves.length === 0) {
      if (args.all) consola.info('Nothing to move.');
      return;
    }

    if (args['dry-run']) {
      if (args.agents) {
        for (const plan of moves) {
          if (plan.repo.localPath === plan.target.localPath) continue;
          const results = await migrateAgentState(
            plan.repo.localPath,
            plan.target.localPath,
            { dryRun: true }
          );
          process.stdout.write(
            `\n${colors.bold(label(plan.repo))} agents:\n${renderAgents(results)}\n`
          );
        }
      }
      consola.info('Dry run — nothing moved.');
      return;
    }

    if (args.all && !args.yes) {
      if (!canPrompt()) {
        consola.error('Refusing to move without --yes: nobody to confirm.');
        process.exitCode = 1;
        return;
      }
      const confirmed = await consola.prompt(`Move ${moves.length} repo(s)?`, {
        type: 'confirm',
        initial: false,
        cancel: 'null'
      });
      if (confirmed !== true) {
        consola.info('Aborted — nothing moved.');
        return;
      }
    }

    let failed = 0;
    for (const plan of moves) {
      const from = plan.repo.localPath;
      const to = plan.target.localPath;
      try {
        await applyMove(plan);
      } catch (error) {
        consola.error(`${label(plan.repo)}: ${(error as Error).message}`);
        failed++;
        continue;
      }
      await removeCachedRepo(context, from);
      await appendCachedRepo(context, plan.target);
      consola.success(
        from === to ? `origin → ${plan.newOrigin}` : `${from} → ${to}`
      );

      if (args.agents && from !== to) {
        const results = await migrateAgentState(from, to);
        process.stdout.write(`${renderAgents(results)}\n`);
      }
      if (process.cwd() === from || process.cwd().startsWith(`${from}/`)) {
        process.stderr.write(
          `${colors.dim(`Your shell is still in the old path — cd ${to}`)}\n`
        );
      }
    }

    const emptied = await pruneEmptyDirs(
      resolveRoot(loaded.config.root, configDir),
      loaded.config
    );
    if (emptied > 0) consola.success(`Removed ${emptied} empty folder(s).`);
    if (failed > 0) process.exitCode = 1;
  }
});
