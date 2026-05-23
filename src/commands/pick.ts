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

    // `$(forgemap pick)` captures stdout, so the interactive TUI must not go
    // there. consola/clack writes the UI to stdout AND reads stdout.rows/columns
    // for layout — but a captured stdout is a pipe (no rows → nothing renders).
    // So for the duration of the prompt: route stdout writes to stderr (the real
    // TTY) and borrow stderr's dimensions, then restore. stdout stays clean for
    // the chosen path only.
    const out = process.stdout;
    const realWrite = out.write;
    const saved = {
      rows: Object.getOwnPropertyDescriptor(out, 'rows'),
      columns: Object.getOwnPropertyDescriptor(out, 'columns'),
      isTTY: Object.getOwnPropertyDescriptor(out, 'isTTY')
    };
    const fake = (key: 'rows' | 'columns' | 'isTTY', value: unknown) => {
      Object.defineProperty(out, key, { configurable: true, value });
    };
    const restore = (key: 'rows' | 'columns' | 'isTTY') => {
      if (saved[key]) Object.defineProperty(out, key, saved[key]!);
      else delete (out as unknown as Record<string, unknown>)[key];
    };

    out.write = process.stderr.write.bind(process.stderr) as typeof out.write;
    fake('rows', process.stderr.rows ?? 24);
    fake('columns', process.stderr.columns ?? 80);
    fake('isTTY', true);

    let choice: unknown;
    try {
      choice = await consola.prompt('Select a repo', {
        type: 'select',
        options: candidates.map((r) => ({
          label: `${colors.gray(`${r.forgeName}:`)}${r.slug}`,
          value: r.localPath,
          hint: r.localPath
        }))
      });
    } finally {
      out.write = realWrite;
      restore('rows');
      restore('columns');
      restore('isTTY');
    }

    if (typeof choice === 'string' && choice) {
      realWrite.call(out, `${choice}\n`);
    }
  }
});
