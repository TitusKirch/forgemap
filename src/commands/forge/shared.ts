import { existsSync } from 'node:fs';
import consola from 'consola';
import { join, relative, resolve } from 'pathe';
import type { EditableConfig, MutableForge } from '../../config/forges.ts';
import type { LoadedConfig } from '../../config/load.ts';
import { discoverConfigFiles } from '../../config/load.ts';
import { mutateConfigFile } from '../../config/mutate.ts';
import { canPrompt } from '../../repos/picker.ts';

/** Whether interactive prompts can be shown (a TTY on stdin to answer them). */
export function interactive(): boolean {
  return canPrompt();
}

/** Prompt for free text. Returns the raw string, or `null` when cancelled. */
export async function promptText(
  message: string,
  placeholder?: string
): Promise<string | null> {
  const answer = await consola.prompt(message, {
    type: 'text',
    placeholder,
    cancel: 'null'
  });
  return typeof answer === 'string' ? answer : null;
}

/** Prompt to pick one of `options`. Returns the value, or `null` when cancelled. */
export async function promptSelect(
  message: string,
  options: readonly string[]
): Promise<string | null> {
  const answer = await consola.prompt(message, {
    type: 'select',
    options: [...options],
    cancel: 'null'
  });
  return typeof answer === 'string' && answer ? answer : null;
}

/** Yes/no confirmation. Returns `false` when declined or cancelled. */
export async function confirmChange(message: string): Promise<boolean> {
  const answer = await consola.prompt(message, {
    type: 'confirm',
    cancel: 'null'
  });
  return answer === true;
}

export interface TargetFile {
  path: string;
  /** The file does not exist yet and will be created (add only). */
  create: boolean;
}

/**
 * Choose which config file `add` writes to.
 *  - `--config <path>` always wins (created when it does not exist).
 *  - otherwise discover candidates: one → use it; several with a TTY → present a
 *    select (the final step before confirming); several without a TTY → nearest.
 *  - nothing discovered → a fresh `forgemap.config.ts` in the cwd.
 *
 * Returns `null` when the user cancels the select.
 */
export async function resolveAddTarget(
  explicit: string | undefined
): Promise<TargetFile | null> {
  if (explicit) {
    const path = resolve(process.cwd(), explicit);
    return { path, create: !existsSync(path) };
  }
  const candidates = discoverConfigFiles();
  if (candidates.length === 0) {
    return { path: join(process.cwd(), 'forgemap.config.ts'), create: true };
  }
  if (candidates.length === 1 || !interactive()) {
    return { path: candidates[0]!.path, create: false };
  }
  const choice = await consola.prompt(
    'Which config file should this change be written to?',
    {
      type: 'select',
      options: candidates.map((c) => ({
        label: relative(process.cwd(), c.path) || c.path,
        value: c.path,
        hint: c.source
      })),
      cancel: 'null'
    }
  );
  if (typeof choice !== 'string' || !choice) {
    consola.info('Aborted — nothing changed.');
    return null;
  }
  return { path: choice, create: false };
}

/**
 * The config file `edit`/`remove` operate on — the forge already lives in a real
 * file, so `--config` or the resolved config file is used. Prints an error and
 * returns `null` when only the built-in defaults are in effect (no file).
 */
export function existingConfigFile(
  loaded: LoadedConfig,
  explicit: string | undefined
): string | null {
  if (explicit) return resolve(process.cwd(), explicit);
  if (!loaded.configFile) {
    consola.error(
      'No forgemap config file found. Run `forgemap config init` or `forgemap forge add` first.'
    );
    return null;
  }
  return loaded.configFile;
}

/**
 * Round-trip `mutate` into `path`; on failure (a config too dynamic to rewrite)
 * report it and print the change for manual application instead of crashing.
 * Returns whether the file was updated.
 */
export async function applyChange(
  path: string,
  mutate: (config: EditableConfig) => void,
  manualHint: () => void
): Promise<boolean> {
  try {
    await mutateConfigFile(path, mutate);
    return true;
  } catch (error) {
    consola.error(
      `Could not update ${path} automatically: ${(error as Error).message}`
    );
    consola.info('Apply this change by hand instead:');
    manualHint();
    return false;
  }
}

/** Print a forge as a `forgemap.config` block (the manual-edit fallback). */
export function printManualForge(key: string, forge: MutableForge): void {
  consola.log(`  ${key}: {`);
  consola.log(`    type: '${forge.type}',`);
  consola.log(`    host: '${forge.host}',`);
  consola.log(`    dir: '${forge.dir}'${forge.protocol ? ',' : ''}`);
  if (forge.protocol) consola.log(`    protocol: '${forge.protocol}'`);
  consola.log('  }');
}
