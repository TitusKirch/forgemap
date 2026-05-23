import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'pathe';
import type { ForgeConfig, ForgeMapConfig } from './schema.ts';

const HEADER = `/**
 * forgemap configuration.
 *
 * For type-safe authoring, install forgemap and switch to:
 *   import { defineForgeMapConfig } from 'forgemap/config';
 *   export default defineForgeMapConfig({ ... });
 *
 * @type {import('forgemap').ForgeMapUserConfig}
 */`;

/** Quote a forge key unless it's already a bare JS identifier. */
function quoteKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`;
}

function renderForge(forge: ForgeConfig): string {
  const lines = [
    `      type: '${forge.type}',`,
    `      host: '${forge.host}',`,
    `      dir: '${forge.dir}'`
  ];
  if (forge.type === 'git' && forge.protocol) {
    lines.splice(1, 0, `      protocol: '${forge.protocol}',`);
  }
  return `{\n${lines.join('\n')}\n    }`;
}

/** Serialize a config to a `forgemap.config.ts` module body. */
export function renderConfigModule(config: ForgeMapConfig): string {
  const forgeEntries = Object.entries(config.forges)
    .map(([name, forge]) => `    ${quoteKey(name)}: ${renderForge(forge)}`)
    .join(',\n');
  return `${HEADER}
export default {
  root: '${config.root}',
  defaultForge: '${config.defaultForge}',
  forges: {
${forgeEntries}
  }
};
`;
}

export interface WriteConfigOptions {
  outDir: string;
  force?: boolean;
}

/** Write a `forgemap.config.ts` into `outDir`. Returns null when the file
 *  already exists and `force` is not set (the caller decides how to report). */
export async function writeConfigFile(
  config: ForgeMapConfig,
  options: WriteConfigOptions
): Promise<{ path: string } | null> {
  const outDir = resolve(process.cwd(), options.outDir);
  const target = join(outDir, 'forgemap.config.ts');
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, renderConfigModule(config), {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx'
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return null;
    }
    throw error;
  }
  return { path: target };
}
