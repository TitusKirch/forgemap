import { readFile, writeFile } from 'node:fs/promises';
import { updateConfig } from 'c12/update';
import { dirname, extname } from 'pathe';
import type { EditableConfig } from './forges.ts';

/**
 * Apply an in-place mutation to a `forgemap.config.*` file, preserving its
 * formatting and comments.
 *
 * `.ts`/`.mts`/`.js`/… are round-tripped through c12's `updateConfig`, which
 * parses the module with magicast and edits the exported object literal — it
 * transparently unwraps a `defineForgeMapConfig(...)` call. Plain `.json`
 * configs, which magicast/updateConfig refuse, are read, mutated and written
 * back directly.
 *
 * Rejects when the source can't be edited safely (e.g. forges built dynamically
 * rather than declared as a literal); callers surface that as a manual-edit
 * fallback rather than crashing.
 */
export async function mutateConfigFile(
  path: string,
  mutate: (config: EditableConfig) => void
): Promise<void> {
  if (extname(path) === '.json') {
    const current = JSON.parse(await readFile(path, 'utf8')) as EditableConfig;
    mutate(current);
    await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    return;
  }
  // `updateConfig` resolves the config by base name from `cwd`; every forgemap
  // config is `forgemap.config.<ext>`, one per directory, so pointing `cwd` at
  // the target file's directory selects exactly that file.
  await updateConfig({
    cwd: dirname(path),
    configFile: 'forgemap.config',
    onUpdate: (config: EditableConfig) => {
      mutate(config);
    }
  });
}
