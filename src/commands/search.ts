import { defineCommand } from 'citty';
import consola from 'consola';
import { colors, formatTree } from 'consola/utils';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { type ScannedRepo, scanRepos } from '../repos/scan.ts';
import { toFileUrl } from '../utils/wsl.ts';

type Format = 'auto' | 'pretty' | 'path' | 'slug';

/**
 * OSC 8 hyperlink. Modern terminals (iTerm2, WezTerm, Kitty, Windows
 * Terminal, GNOME Terminal, VS Code) render it as a clickable link; old
 * ones just show the visible text.
 */
function osc8(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function renderTree(repos: ScannedRepo[]): string {
  const groups = new Map<string, ScannedRepo[]>();
  for (const r of repos) {
    const list = groups.get(r.forgeName);
    if (list) list.push(r);
    else groups.set(r.forgeName, [r]);
  }

  return formatTree(
    Array.from(groups, ([forge, items]) => ({
      text: colors.bold(forge),
      children: items.map((r) => ({
        text: `${colors.cyan(r.slug)}  ${osc8(toFileUrl(r.localPath), colors.dim(r.localPath))}`
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

    const fuse = new Fuse(repos, {
      keys: ['slug', 'owner', 'repo'],
      threshold: 0.3,
      ignoreLocation: true,
      includeScore: true
    });

    const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
    const results = fuse.search(args.query, limit ? { limit } : undefined);
    const items = results.map((r) => r.item);

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
