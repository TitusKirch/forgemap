import { defineCommand } from 'citty';
import consola from 'consola';
import { colors, formatTree } from 'consola/utils';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { matchRepos } from '../repos/match.ts';
import { type ScannedRepo, scanRepos } from '../repos/scan.ts';

type Format = 'auto' | 'pretty' | 'path' | 'slug';

// Three levels, like a path: forge → owner → repo.
function renderTree(repos: ScannedRepo[]): string {
  const byForge = new Map<string, Map<string, ScannedRepo[]>>();
  for (const r of repos) {
    let owners = byForge.get(r.forgeName);
    if (!owners) {
      owners = new Map();
      byForge.set(r.forgeName, owners);
    }
    const list = owners.get(r.owner);
    if (list) list.push(r);
    else owners.set(r.owner, [r]);
  }

  return formatTree(
    Array.from(byForge, ([forge, owners]) => ({
      text: colors.bold(forge),
      children: Array.from(owners, ([owner, items]) => ({
        text: owner,
        children: items.map((r) => ({
          text: `${colors.cyan(r.repo)}  ${colors.dim(r.localPath)}`
        }))
      }))
    }))
  );
}

export const searchCommand = defineCommand({
  meta: {
    name: 'search',
    description:
      'Fuzzy-search cloned repos by owner/repo and print matching repos'
  },
  args: {
    query: {
      type: 'positional',
      description: 'Search term (matched fuzzily against <owner>/<repo>)',
      required: true
    },
    format: {
      type: 'string',
      description:
        'Output format: auto (default), pretty, path, or slug. auto picks pretty in a TTY, path when piped.',
      default: 'auto'
    },
    limit: {
      type: 'string',
      description: 'Maximum number of matches to print (default: unlimited)'
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
    const repos = await scanRepos({ config: loaded.config, configDir });

    const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
    const items = matchRepos(repos, args.query, limit);

    const allowed: Format[] = ['auto', 'pretty', 'path', 'slug'];
    if (!allowed.includes(args.format as Format)) {
      consola.error(
        `Invalid --format value "${args.format}". Allowed: ${allowed.join(', ')}.`
      );
      process.exitCode = 1;
      return;
    }
    const requested = args.format as Format;
    const format: Exclude<Format, 'auto'> =
      requested === 'auto'
        ? process.stdout.isTTY
          ? 'pretty'
          : 'path'
        : requested;

    if (items.length === 0) {
      if (format === 'pretty') consola.info(`No matches for "${args.query}".`);
      return;
    }

    if (format === 'pretty') {
      process.stdout.write(`${renderTree(items)}\n`);
      return;
    }

    for (const item of items) {
      process.stdout.write(
        `${format === 'slug' ? item.slug : item.localPath}\n`
      );
    }
  }
});
