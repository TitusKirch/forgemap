import { defineCommand } from 'citty';
import { loadForgeMapConfig } from '../config/load.ts';
import { dirname } from 'pathe';
import { parseSlug } from '../slug/parse.ts';
import { resolveSlug } from '../slug/resolve.ts';

export const pathCommand = defineCommand({
  meta: {
    name: 'path',
    description: 'Print the local path where a repo lives (or would live)'
  },
  args: {
    slug: {
      type: 'positional',
      description: 'owner/repo, forge:owner/repo, or full URL',
      required: true
    },
    config: {
      type: 'string',
      description: 'Path to forgemap.config.ts (overrides walk-up discovery)'
    }
  },
  async run({ args }) {
    const loaded = await loadForgeMapConfig({ configFile: args.config });
    const parsed = parseSlug(args.slug);
    const configDir = loaded.configFile
      ? dirname(loaded.configFile)
      : loaded.cwd;
    const resolved = resolveSlug(parsed, {
      config: loaded.config,
      configDir
    });
    process.stdout.write(`${resolved.localPath}\n`);
  }
});
