import { defineCommand } from 'citty';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { resolveRepoPath } from '../slug/locate.ts';

export const pathCommand = defineCommand({
  meta: {
    name: 'path',
    description: 'Print the local path where a repo lives (or would live)'
  },
  args: {
    slug: {
      type: 'positional',
      description:
        'owner/repo, forge:owner/repo, full URL, or a fuzzy query matched against cloned repos',
      required: true
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
    const localPath = await resolveRepoPath(args.slug, {
      config: loaded.config,
      configDir
    });
    if (!localPath) {
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${localPath}\n`);
  }
});
