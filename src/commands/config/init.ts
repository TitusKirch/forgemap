import { mkdir, writeFile } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { dirname, join, resolve } from 'pathe';

const TEMPLATE = `/**
 * forgemap configuration.
 *
 * For type-safe authoring, install forgemap and switch to:
 *   import { defineForgeMapConfig } from 'forgemap/config';
 *   export default defineForgeMapConfig({ ... });
 *
 * @type {import('forgemap').ForgeMapUserConfig}
 */
export default {
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
`;

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
    const outDir = resolve(process.cwd(), args.out);
    const target = join(outDir, 'forgemap.config.ts');

    await mkdir(dirname(target), { recursive: true });

    try {
      await writeFile(target, TEMPLATE, {
        encoding: 'utf8',
        flag: args.force ? 'w' : 'wx'
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        consola.error(`${target} already exists. Use --force to overwrite.`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    consola.success(`Wrote ${target}`);
  }
});
