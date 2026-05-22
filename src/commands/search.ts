import { defineCommand } from 'citty';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { scanRepos, type ScannedRepo } from '../repos/scan.ts';

export const searchCommand = defineCommand({
  meta: {
    name: 'search',
    description:
      'Fuzzy-search cloned repos by owner/repo and print matching paths'
  },
  args: {
    query: {
      type: 'positional',
      description: 'Search term (matched fuzzily against <owner>/<repo>)',
      required: true
    },
    slug: {
      type: 'boolean',
      description: 'Print "<owner>/<repo>" instead of the full local path',
      default: false
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
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true
    });

    const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
    const results = fuse.search(args.query, limit ? { limit } : undefined);

    for (const { item } of results) {
      process.stdout.write(
        `${args.slug ? (item as ScannedRepo).slug : (item as ScannedRepo).localPath}\n`
      );
    }
  }
});
