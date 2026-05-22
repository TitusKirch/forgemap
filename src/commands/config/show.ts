import { defineCommand } from 'citty';
import { loadForgeMapConfig } from '../../config/load.ts';

export const configShowCommand = defineCommand({
  meta: {
    name: 'show',
    description: 'Print the resolved forgemap config and its source path'
  },
  args: {
    config: {
      type: 'string',
      description: 'Path to forgemap.config.ts (overrides walk-up discovery)'
    }
  },
  async run({ args }) {
    const loaded = await loadForgeMapConfig({ configFile: args.config });
    process.stdout.write(
      JSON.stringify(
        {
          configFile: loaded.configFile ?? null,
          cwd: loaded.cwd,
          config: loaded.config
        },
        null,
        2
      ) + '\n'
    );
  }
});
