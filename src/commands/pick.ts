import { defineCommand } from 'citty';
import consola from 'consola';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { matchRepos } from '../repos/match.ts';
import { canPrompt, promptRepoChoice } from '../repos/picker.ts';
import { type ScannedRepo, scanRepos } from '../repos/scan.ts';

export const pickCommand = defineCommand({
  meta: {
    name: 'pick',
    description:
      'Interactively pick a cloned repo from the configured layout and print its path'
  },
  args: {
    query: {
      type: 'positional',
      description: 'Optional fuzzy filter applied before showing the picker',
      required: false
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
    const all = await scanRepos({ config: loaded.config, configDir });

    const candidates: ScannedRepo[] = args.query
      ? matchRepos(all, args.query)
      : all;

    if (candidates.length === 0) {
      consola.error(
        args.query
          ? `No repos match "${args.query}".`
          : 'No repos found under the configured root.'
      );
      process.exitCode = 1;
      return;
    }

    if (candidates.length === 1) {
      process.stdout.write(`${candidates[0]!.localPath}\n`);
      return;
    }

    if (!canPrompt()) {
      consola.error(
        'pick requires an interactive terminal. Use `forgemap list` for non-interactive output.'
      );
      process.exitCode = 1;
      return;
    }

    const choice = await promptRepoChoice(candidates);
    if (choice) {
      process.stdout.write(`${choice}\n`);
    }
  }
});
