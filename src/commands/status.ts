import { defineCommand } from 'citty';
import consola from 'consola';
import { colors, formatTree } from 'consola/utils';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { scanReposCached } from '../repos/cache.ts';
import { filterArg, filterRepos, resolveFilters } from '../repos/filter.ts';
import { getRepoStatus, type RepoStatus } from '../repos/git.ts';
import type { ScannedRepo } from '../repos/scan.ts';

interface Row {
  repo: ScannedRepo;
  status: RepoStatus | null;
  error?: string;
}

function statusLine(row: Row): string {
  if (row.error || !row.status) {
    return `${colors.cyan(row.repo.repo)}  ${colors.red(`error: ${row.error ?? 'unknown'}`)}`;
  }
  const s = row.status;
  const parts: string[] = [colors.cyan(row.repo.repo)];
  const aheadBehind: string[] = [];
  if (s.ahead > 0) aheadBehind.push(colors.green(`↑${s.ahead}`));
  if (s.behind > 0) aheadBehind.push(colors.yellow(`↓${s.behind}`));
  if (aheadBehind.length > 0) parts.push(aheadBehind.join(' '));
  parts.push(s.dirty ? colors.red('●') : colors.green('✓'));
  // Stashed work is invisible to every other marker here — surface it before
  // it matters (e.g. before `cleanup` considers the repo).
  if (s.stashes > 0) parts.push(colors.yellow(`⚑${s.stashes}`));
  parts.push(colors.gray(s.branch));
  if (s.lastCommit) {
    parts.push(colors.dim(`${s.lastCommit.sha} ${s.lastCommit.relativeDate}`));
  }
  return parts.join('  ');
}

// Three levels, like a path: forge → owner → repo.
function renderTree(rows: Row[]): string {
  const byForge = new Map<string, Map<string, Row[]>>();
  for (const row of rows) {
    let owners = byForge.get(row.repo.forgeName);
    if (!owners) {
      owners = new Map();
      byForge.set(row.repo.forgeName, owners);
    }
    const list = owners.get(row.repo.owner);
    if (list) list.push(row);
    else owners.set(row.repo.owner, [row]);
  }
  return formatTree(
    Array.from(byForge, ([forge, owners]) => ({
      text: colors.bold(forge),
      children: Array.from(owners, ([owner, items]) => ({
        text: owner,
        children: items.map((row) => ({ text: statusLine(row) }))
      }))
    }))
  );
}

const ALLOWED_FORMATS = ['pretty', 'json'];

export const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Show branch, dirty, ahead/behind, and last commit per repo'
  },
  args: {
    format: {
      type: 'string',
      description: 'Output format: pretty (default) or json',
      default: 'pretty'
    },
    forge: {
      type: 'string',
      description: 'Restrict to a single forge alias'
    },
    filter: filterArg,
    query: {
      type: 'string',
      description: 'Fuzzy filter against <owner>/<repo>'
    },
    cache: {
      type: 'boolean',
      description: 'Use the scanned-repos cache',
      negativeDescription: 'Skip the scanned-repos cache',
      default: true
    },
    config: {
      type: 'string',
      description: 'Path to forgemap.config.ts (overrides walk-up discovery)'
    }
  },
  async run({ args, rawArgs }) {
    if (!ALLOWED_FORMATS.includes(args.format)) {
      consola.error(
        `Invalid --format value "${args.format}". Allowed: ${ALLOWED_FORMATS.join(', ')}.`
      );
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
      useCache: args.cache
    });

    if (args.forge) {
      repos = repos.filter((r) => r.forgeName === args.forge);
    }
    repos = filterRepos(repos, resolveFilters(rawArgs, args.filter));
    if (args.query) {
      const fuse = new Fuse(repos, {
        keys: ['slug', 'owner', 'repo'],
        threshold: 0.3,
        ignoreLocation: true
      });
      repos = fuse.search(args.query).map((r) => r.item);
    }

    const rows: Row[] = await Promise.all(
      repos.map(async (repo) => {
        try {
          return { repo, status: await getRepoStatus(repo.localPath) };
        } catch (error) {
          return { repo, status: null, error: (error as Error).message };
        }
      })
    );

    if (args.format === 'json') {
      process.stdout.write(
        `${JSON.stringify(
          rows.map((r) => ({
            forge: r.repo.forgeName,
            owner: r.repo.owner,
            repo: r.repo.repo,
            localPath: r.repo.localPath,
            status: r.status,
            error: r.error ?? null
          })),
          null,
          2
        )}\n`
      );
      return;
    }

    if (rows.length === 0) {
      consola.info('No repos to report on.');
      return;
    }
    process.stdout.write(`${renderTree(rows)}\n`);
  }
});
