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

  const { config, configFile } = await loadConfig<ForgeMapUserConfig>({
    name: 'forgemap',
    cwd,
    configFile: explicit ? explicit : 'forgemap.config',
    rcFile: false,
    globalRc: false,
    dotenv: false,
    defaults: DEFAULT_CONFIG
  });

  const merged: ForgeMapConfig = {
    root: config.root ?? DEFAULT_CONFIG.root,
    defaultForge: config.defaultForge ?? DEFAULT_CONFIG.defaultForge,
    forges: {
      ...DEFAULT_CONFIG.forges,
      ...config.forges
    }
  };

  return {
    config: merged,
    configFile: configFile || undefined,
    cwd
  };
}
