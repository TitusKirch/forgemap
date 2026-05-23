import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import type { GitProtocol } from '../config/schema.ts';
import { getForgeAdapter } from '../forges/registry.ts';
import { parseSlug } from '../slug/parse.ts';
import { resolveSlug } from '../slug/resolve.ts';

export const cloneCommand = defineCommand({
  meta: {
    name: 'clone',
    description: 'Clone a repo into the configured local layout'
  },
  args: {
    slug: {
      type: 'positional',
      description: 'owner/repo, forge:owner/repo, or full URL',
      required: true
    },
    ssh: {
      type: 'boolean',
      description: 'Force the SSH URL form (git-type forges only)',
      default: false
    },
    https: {
      type: 'boolean',
      description: 'Force the HTTPS URL form (git-type forges only)',
      default: false
    },
    config: {
      type: 'string',
      description: 'Path to forgemap.config.ts (overrides walk-up discovery)'
    }
  },
  async run({ args }) {
    if (args.ssh && args.https) {
      consola.error('--ssh and --https are mutually exclusive.');
      process.exitCode = 1;
      return;
    }

    const loaded = await loadForgeMapConfig({ configFile: args.config });
    const parsed = parseSlug(args.slug);
    const configDir = loaded.configFile
      ? dirname(loaded.configFile)
      : loaded.cwd;
    const resolved = resolveSlug(parsed, {
      config: loaded.config,
      configDir
    });

    let protocol: GitProtocol | undefined;
    if (args.ssh) protocol = 'ssh';
    else if (args.https) protocol = 'https';

    if (protocol && resolved.forge.type !== 'git') {
      consola.warn(
        `--${protocol} is ignored for type "${resolved.forge.type}" — the adapter selects the URL itself.`
      );
      protocol = undefined;
    }

    if (existsSync(resolved.localPath)) {
      consola.info(`Already cloned at ${resolved.localPath}`);
      return;
    }

    await mkdir(dirname(resolved.localPath), { recursive: true });

    const adapter = getForgeAdapter(resolved.forge.type);
    await adapter.clone({
      forge: resolved.forge,
      owner: resolved.owner,
      repo: resolved.repo,
      dest: resolved.localPath,
      protocol
    });

    consola.success(
      `Cloned ${resolved.owner}/${resolved.repo} → ${resolved.localPath}`
    );
  }
});
