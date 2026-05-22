import { defineCommand } from 'citty';
import consola from 'consola';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { type ScannedRepo, scanRepos } from '../repos/scan.ts';
import { bold, cyan, dim, gray, isInteractive } from '../utils/color.ts';

type Format = 'pretty' | 'path' | 'slug';

function renderPretty(repos: ScannedRepo[]): string {
  const tags = repos.map((r) => `${r.forgeName}:${r.slug}`);
  const width = Math.max(...tags.map((t) => t.length));
  return repos
    .map((r, i) => {
      const [forge, slug] = tags[i]!.split(':');
      const tag = `${gray(`${forge}:`)}${bold(cyan(slug!))}`;
      const padding = ' '.repeat(width - tags[i]!.length + 2);
      return `${tag}${padding}${dim(r.localPath)}`;
    })
    .join('\n');
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
        'Output format: pretty (default in TTY), path, or slug (default when piped)'
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

    const format: Format =
      (args.format as Format | undefined) ??
      (isInteractive ? 'pretty' : 'path');

    if (items.length === 0) {
      if (format === 'pretty') consola.info(`No matches for "${args.query}".`);
      return;
    }

    if (format === 'pretty') {
      process.stdout.write(`${renderPretty(items)}\n`);
      return;
    }

    for (const item of items) {
      process.stdout.write(
        `${format === 'slug' ? item.slug : item.localPath}\n`
      );
    }
  }
});
