import { defineCommand } from 'citty';
import consola from 'consola';
import {
  FORGE_TYPES,
  GIT_PROTOCOLS,
  type ForgePatch,
  type MutableForge,
  editForge,
  isForgeType,
  isGitProtocol
} from '../../config/forges.ts';
import { loadForgeMapConfig } from '../../config/load.ts';
import type { ForgeType, GitProtocol } from '../../config/schema.ts';
import {
  applyChange,
  confirmChange,
  existingConfigFile,
  interactive,
  printManualForge,
  promptSelect,
  promptText
} from './shared.ts';

export const forgeEditCommand = defineCommand({
  meta: {
    name: 'edit',
    description:
      'Edit an existing forge (prompts for fields when none are passed)'
  },
  args: {
    key: {
      type: 'positional',
      required: false,
      description: 'Forge key to edit'
    },
    type: {
      type: 'string',
      description: `New forge type (${FORGE_TYPES.join(', ')})`
    },
    host: { type: 'string', description: 'New host' },
    dir: { type: 'string', description: 'New directory under root' },
    protocol: {
      type: 'string',
      description: `New clone protocol for type=git (${GIT_PROTOCOLS.join(', ')})`
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
        'Which forge should be edited?',
        Object.keys(forges)
      );
      if (answer === null) return abort();
      key = answer;
    }
    if (!key) return fail('Missing forge key. Pass it as an argument.');
    const current = forges[key];
    if (!current) {
      return fail(
        `No forge "${key}" in ${file}. Configured: ${Object.keys(forges).join(', ')}.`
      );
    }
    const currentProtocol =
      current.type === 'git' ? current.protocol : undefined;

    const patch: ForgePatch = {};

    // ---- type ----
    if (typeof args.type === 'string') {
      if (!isForgeType(args.type)) return fail(invalidType(args.type));
      patch.type = args.type;
    } else if (tty) {
      const answer = await promptSelect(
        `Type (current: ${current.type}):`,
        FORGE_TYPES
      );
      if (answer === null) return abort();
      if (isForgeType(answer)) patch.type = answer;
    }
    const resultType: ForgeType = patch.type ?? current.type;

    // ---- host ----
    if (typeof args.host === 'string') {
      patch.host = args.host.trim();
    } else if (tty) {
      const answer = await promptText(
        `Host (current: ${current.host}):`,
        current.host
      );
      if (answer === null) return abort();
      if (answer.trim()) patch.host = answer.trim();
    }

    // ---- dir ----
    if (typeof args.dir === 'string') {
      patch.dir = args.dir.trim();
    } else if (tty) {
      const answer = await promptText(
        `Directory (current: ${current.dir}):`,
        current.dir
      );
      if (answer === null) return abort();
      if (answer.trim()) patch.dir = answer.trim();
    }

    // ---- protocol (only when the resulting type is git) ----
    if (resultType === 'git') {
      if (typeof args.protocol === 'string') {
        if (!isGitProtocol(args.protocol)) {
          return fail(invalidProtocol(args.protocol));
        }
        patch.protocol = args.protocol;
      } else if (tty) {
        const answer = await promptSelect('Clone protocol:', GIT_PROTOCOLS);
        if (answer !== null && isGitProtocol(answer)) patch.protocol = answer;
      }
    }

    if (!hasChanges(patch)) {
      return fail(
        'Nothing to change. Pass --type, --host, --dir or --protocol.'
      );
    }

    consola.info(`Edit forge "${key}" in ${file}`);
    if (tty && !args.yes && !(await confirmChange('Apply this change?'))) {
      return abort();
    }

    const merged = mergeForge(current, currentProtocol, patch, resultType);
    const applied = await applyChange(
      file,
      (c) => editForge(c, key, patch),
      () => {
        consola.log(`Update the "${key}" entry to:`);
        printManualForge(key, merged);
      }
    );
    if (applied) consola.success(`Edited forge "${key}" in ${file}`);
    else process.exitCode = 1;
  }
});

function hasChanges(patch: ForgePatch): boolean {
  return (
    patch.type !== undefined ||
    patch.host !== undefined ||
    patch.dir !== undefined ||
    patch.protocol !== undefined
  );
}

function mergeForge(
  current: { type: ForgeType; host: string; dir: string },
  currentProtocol: GitProtocol | undefined,
  patch: ForgePatch,
  resultType: ForgeType
): MutableForge {
  // `ForgePatch.protocol` can be null (editForge reads that as "clear it"), but
  // this command never sets it — a protocol only ever goes away by leaving git.
  const protocol =
    resultType === 'git' ? (patch.protocol ?? currentProtocol) : undefined;
  return {
    type: resultType,
    host: patch.host ?? current.host,
    dir: patch.dir ?? current.dir,
    ...(protocol ? { protocol } : {})
  };
}

function fail(message: string): void {
  consola.error(message);
  process.exitCode = 1;
}

function abort(): void {
  consola.info('Aborted — nothing changed.');
}

function invalidType(value: string): string {
  return `Invalid type "${value}". Expected one of: ${FORGE_TYPES.join(', ')}.`;
}

function invalidProtocol(value: string): string {
  return `Invalid protocol "${value}". Expected one of: ${GIT_PROTOCOLS.join(', ')}.`;
}
