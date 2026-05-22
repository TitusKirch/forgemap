import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import Fuse from 'fuse.js';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
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

    let candidates: ScannedRepo[];
    if (args.query) {
      const fuse = new Fuse(all, {
        keys: ['slug', 'owner', 'repo'],
        threshold: 0.3,
        ignoreLocation: true
      });
      candidates = fuse.search(args.query).map((r) => r.item);
    } else {
      candidates = all;
    }

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

    if (!process.stdin.isTTY) {
      consola.error(
        'pick requires an interactive terminal. Use `forgemap search` for non-interactive output.'
      );
      process.exitCode = 1;
      return;
    }

    const choice = await consola.prompt('Select a repo', {
      type: 'select',
      options: candidates.map((r) => ({
        label: `${colors.gray(`${r.forgeName}:`)}${r.slug}`,
        value: r.localPath,
        hint: r.localPath
      }))
    });

    if (typeof choice === 'string' && choice) {
      process.stdout.write(`${choice}\n`);
    }
  }
});
