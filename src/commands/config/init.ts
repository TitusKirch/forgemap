import { defineCommand } from 'citty';
import consola from 'consola';
import { join, resolve } from 'pathe';
import type { ForgeMapConfig } from '../../config/schema.ts';
import { writeConfigFile } from '../../config/write.ts';

const DEFAULT_CONFIG: ForgeMapConfig = {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: {
      type: 'github',
      host: 'github.com',
      dir: 'comGithub'
    }
  }
};

export const configInitCommand = defineCommand({
  meta: {
    name: 'init',
    description:
      'Create a forgemap.config.ts in the current (or given) directory'
  },
  args: {
    out: {
      type: 'string',
      description: 'Directory to write forgemap.config.ts into',
      default: '.'
    },
    force: {
      type: 'boolean',
      description: 'Overwrite if forgemap.config.ts already exists',
      default: false
    }
  },
  async run({ args }) {
    const result = await writeConfigFile(DEFAULT_CONFIG, {
      outDir: args.out,
      force: args.force
    });

    if (!result) {
      const target = join(
        resolve(process.cwd(), args.out),
        'forgemap.config.ts'
      );
      consola.error(`${target} already exists. Use --force to overwrite.`);
      process.exitCode = 1;
      return;
    }

    consola.success(`Wrote ${result.path}`);
  }
});
