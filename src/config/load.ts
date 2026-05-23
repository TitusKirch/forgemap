import { loadConfig } from 'c12';
import { dirname } from 'pathe';
import type { ForgeMapConfig, ForgeMapUserConfig } from './schema.ts';

export interface LoadedConfig {
  config: ForgeMapConfig;
  configFile: string | undefined;
  cwd: string;
}

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

export interface LoadOptions {
  cwd?: string;
  configFile?: string;
}

export async function loadForgeMapConfig(
  options: LoadOptions = {}
): Promise<LoadedConfig> {
  const envConfig = process.env.FORGEMAP_CONFIG;
  const explicit = options.configFile ?? envConfig;
  const cwd = explicit ? dirname(explicit) : (options.cwd ?? process.cwd());

  // No `defaults:` here — c12 would deep-merge them into the user
  // config (forges in particular), which surfaces the built-in github
  // forge in every custom layout. We apply defaults below ourselves,
  // only filling in missing top-level fields.
  const { config, configFile } = await loadConfig<ForgeMapUserConfig>({
    name: 'forgemap',
    cwd,
    configFile: explicit ? explicit : 'forgemap.config',
    rcFile: false,
    globalRc: false,
    dotenv: false
  });

  // User-defined forges replace the defaults entirely — otherwise the
  // built-in github fallback would pollute every custom config and
  // commands like `validate` would demand `gh` even when no github
  // forge is configured.
  const merged: ForgeMapConfig = {
    root: config.root ?? DEFAULT_CONFIG.root,
    defaultForge: config.defaultForge ?? DEFAULT_CONFIG.defaultForge,
    forges:
      config.forges && Object.keys(config.forges).length > 0
        ? config.forges
        : DEFAULT_CONFIG.forges
  };

  return {
    config: merged,
    configFile: configFile || undefined,
    cwd
  };
}
