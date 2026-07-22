import { defineCommand } from 'citty';
import consola from 'consola';
import { removeForge, setDefaultForge } from '../../config/forges.ts';
import { loadForgeMapConfig } from '../../config/load.ts';
import {
  applyChange,
  confirmChange,
  existingConfigFile,
  interactive,
  promptSelect
} from './shared.ts';

const LEAVE_UNSET = '— leave unset —';

export const forgeRemoveCommand = defineCommand({
  meta: {
    name: 'remove',
    description: 'Remove a forge from the config'
  },
  args: {
    key: {
      type: 'positional',
      required: false,
      description: 'Forge key to remove'
    },
    default: {
      type: 'string',
      description:
        'When removing the default forge, reassign the default to this'
    },
    config: {
      type: 'string',
      description: 'Path to the forgemap config file to modify'
    },
    yes: {
      type: 'boolean',
      description: 'Skip the confirmation prompt',
      default: false
    }
  },
  async run({ args }) {
    const loaded = await loadForgeMapConfig({ configFile: args.config });
    const tty = interactive();

    const file = existingConfigFile(loaded, args.config);
    if (!file) {
      process.exitCode = 1;
      return;
    }

    const forges = loaded.config.forges;

    // ---- which forge ----
    let key = typeof args.key === 'string' ? args.key.trim() : '';
    if (!key && tty) {
      const answer = await promptSelect(
        'Which forge should be removed?',
        Object.keys(forges)
      );
      if (answer === null) return abort();
      key = answer;
    }
    if (!key) return fail('Missing forge key. Pass it as an argument.');
    if (!(key in forges)) {
      return fail(
        `No forge "${key}" in ${file}. Configured: ${Object.keys(forges).join(', ')}.`
      );
    }

    // ---- reassign the default when it is the one being removed ----
    const remaining = Object.keys(forges).filter((k) => k !== key);
    let newDefault: string | undefined;
    if (loaded.config.defaultForge === key && remaining.length > 0) {
      if (typeof args.default === 'string') {
        if (!remaining.includes(args.default)) {
          return fail(
            `Cannot set default to "${args.default}" — not a remaining forge (${remaining.join(', ')}).`
          );
        }
        newDefault = args.default;
      } else if (tty) {
        const answer = await promptSelect(
          `"${key}" is the default forge. Pick a new default:`,
          [...remaining, LEAVE_UNSET]
        );
        if (answer === null) return abort();
        if (answer !== LEAVE_UNSET) newDefault = answer;
      } else {
        consola.warn(
          `Removing the default forge "${key}"; defaultForge now points at a missing forge. Pass --default to reassign it.`
        );
      }
    }

    consola.info(
      `Remove forge "${key}" from ${file}${newDefault ? ` (new default: "${newDefault}")` : ''}`
    );
    if (tty && !args.yes && !(await confirmChange('Apply this change?'))) {
      return abort();
    }

    const applied = await applyChange(
      file,
      (c) => {
        removeForge(c, key);
        if (newDefault) setDefaultForge(c, newDefault);
      },
      () => consola.log(`Remove the "${key}" entry from \`forges\` in ${file}.`)
    );
    if (applied) consola.success(`Removed forge "${key}" from ${file}`);
    else process.exitCode = 1;
  }
});

function fail(message: string): void {
  consola.error(message);
  process.exitCode = 1;
}

function abort(): void {
  consola.info('Aborted — nothing changed.');
}
