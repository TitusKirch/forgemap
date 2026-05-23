import { defineCommand } from 'citty';
import consola from 'consola';
import { colors, formatTree } from 'consola/utils';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { scanReposCached } from '../repos/cache.ts';
import { getRepoStatus, type RepoStatus } from '../repos/git.ts';
import type { ScannedRepo } from '../repos/scan.ts';

interface Row {
  repo: ScannedRepo;
  status: RepoStatus | null;
  error?: string;
}

function statusLine(row: Row): string {
  if (row.error || !row.status) {
    return `${colors.cyan(row.repo.slug)}  ${colors.red(`error: ${row.error ?? 'unknown'}`)}`;
  }
  const s = row.status;
  const parts: string[] = [colors.cyan(row.repo.slug)];
  const aheadBehind: string[] = [];
  if (s.ahead > 0) aheadBehind.push(colors.green(`↑${s.ahead}`));
  if (s.behind > 0) aheadBehind.push(colors.yellow(`↓${s.behind}`));
  if (aheadBehind.length > 0) parts.push(aheadBehind.join(' '));
  parts.push(s.dirty ? colors.red('●') : colors.green('✓'));
  parts.push(colors.gray(s.branch));
  if (s.lastCommit) {
    parts.push(colors.dim(`${s.lastCommit.sha} ${s.lastCommit.relativeDate}`));
  }
  return parts.join('  ');
}

function renderTree(rows: Row[]): string {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const list = groups.get(row.repo.forgeName);
    if (list) list.push(row);
    else groups.set(row.repo.forgeName, [row]);
  }
  return formatTree(
    Array.from(groups, ([forge, items]) => ({
      text: colors.bold(forge),
      children: items.map((row) => ({ text: statusLine(row) }))
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
