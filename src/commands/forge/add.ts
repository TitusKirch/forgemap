import { defineCommand } from 'citty';
import consola from 'consola';
import { dirname } from 'pathe';
import {
  DEFAULT_HOSTS,
  FORGE_TYPES,
  GIT_PROTOCOLS,
  addForge,
  buildForge,
  isForgeType,
  isGitProtocol,
  setDefaultForge,
  validateForgeKey
} from '../../config/forges.ts';
import { loadForgeMapConfig } from '../../config/load.ts';
import type {
  ForgeMapConfig,
  ForgeType,
  GitProtocol
} from '../../config/schema.ts';
import { writeConfigFile } from '../../config/write.ts';
import {
  applyChange,
  confirmChange,
  interactive,
  printManualForge,
  promptSelect,
  promptText,
  resolveAddTarget
} from './shared.ts';

export const forgeAddCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Add a forge to the config (prompts for anything not passed)'
  },
  args: {
    key: {
      type: 'positional',
      required: false,
      description: 'Forge key, e.g. github or work'
    },
    type: {
      type: 'string',
      description: `Forge type (${FORGE_TYPES.join(', ')})`
    },
    host: { type: 'string', description: 'Forge host, e.g. github.com' },
    dir: {
      type: 'string',
      description: 'Directory under root, e.g. comGithub'
    },
    protocol: {
      type: 'string',
      description: `Clone protocol for type=git (${GIT_PROTOCOLS.join(', ')})`
    },
    default: {
      type: 'boolean',
      description: 'Set this forge as the default',
      default: false
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

    // ---- key ----
    let key = typeof args.key === 'string' ? args.key.trim() : '';
    if (!key && tty) {
      const answer = await promptText('Forge key (e.g. github, work):');
      if (answer === null) return abort();
      key = answer.trim();
    }
    const keyError = validateForgeKey(key);
    if (keyError) return fail(keyError);
    if (loaded.configFile && key in loaded.config.forges) {
      return fail(
        `Forge "${key}" already exists. Use \`forgemap forge edit ${key}\` to change it.`
      );
    }

    // ---- type ----
    let type: ForgeType | undefined;
    if (typeof args.type === 'string') {
      if (!isForgeType(args.type)) return fail(invalidType(args.type));
      type = args.type;
    } else if (tty) {
      const answer = await promptSelect('Forge type:', FORGE_TYPES);
      if (answer === null || !isForgeType(answer)) return abort();
      type = answer;
    }
    if (!type) return fail('Missing forge type. Pass --type.');

    // ---- host ----
    const suggestedHost = DEFAULT_HOSTS[type] ?? '';
    let host = typeof args.host === 'string' ? args.host.trim() : '';
    if (!host && tty) {
      const answer = await promptText('Host:', suggestedHost);
      if (answer === null) return abort();
      host = answer.trim() || suggestedHost;
    } else if (!host) {
      host = suggestedHost;
    }
    if (!host) return fail('Missing host. Pass --host.');

    // ---- dir ----
    let dir = typeof args.dir === 'string' ? args.dir.trim() : '';
    if (!dir && tty) {
      const answer = await promptText('Directory (under root):');
      if (answer === null) return abort();
      dir = answer.trim();
    }
    if (!dir) return fail('Missing directory. Pass --dir.');

    // ---- protocol (git only) ----
    let protocol: GitProtocol | undefined;
    if (type === 'git') {
      if (typeof args.protocol === 'string') {
        if (!isGitProtocol(args.protocol)) {
          return fail(invalidProtocol(args.protocol));
        }
        protocol = args.protocol;
      } else if (tty) {
        const answer = await promptSelect('Clone protocol:', GIT_PROTOCOLS);
        if (answer !== null && isGitProtocol(answer)) protocol = answer;
      }
    }

    // ---- default forge? ----
    // A brand-new config needs a default, so the first forge always becomes it.
    let makeDefault = args.default === true;
    if (!loaded.configFile) {
      makeDefault = true;
    } else if (!makeDefault && tty) {
      makeDefault = await confirmChange(`Set "${key}" as the default forge?`);
    }

    const forge = buildForge({ type, host, dir, protocol });

    // ---- target file (the final choice before applying) ----
    const target = await resolveAddTarget(args.config);
    if (!target) return;

    consola.info(
      `Add forge "${key}" (${type} → ${host}) into ${target.create ? 'new ' : ''}${target.path}`
    );
    if (tty && !args.yes && !(await confirmChange('Apply this change?'))) {
      return abort();
    }

    // ---- apply ----
    if (target.create) {
      const config: ForgeMapConfig = {
        root: loaded.config.root,
        defaultForge: key,
        forges: { [key]: forge }
      };
      const written = await writeConfigFile(config, {
        outDir: dirname(target.path)
      });
      if (!written) return fail(`${target.path} already exists.`);
      consola.success(`Added forge "${key}" — wrote ${written.path}`);
      return;
    }

    const applied = await applyChange(
      target.path,
      (c) => {
        addForge(c, key, forge);
        if (makeDefault) setDefaultForge(c, key);
      },
      () => printManualForge(key, forge)
    );
    if (applied) consola.success(`Added forge "${key}" to ${target.path}`);
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

function invalidType(value: string): string {
  return `Invalid type "${value}". Expected one of: ${FORGE_TYPES.join(', ')}.`;
}

function invalidProtocol(value: string): string {
  return `Invalid protocol "${value}". Expected one of: ${GIT_PROTOCOLS.join(', ')}.`;
}
