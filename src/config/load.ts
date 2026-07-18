import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { loadConfig } from 'c12';
import { dirname, join, resolve } from 'pathe';
import type { ForgeMapConfig, ForgeMapUserConfig } from './schema.ts';

const CONFIG_BASENAMES = [
  'forgemap.config.ts',
  'forgemap.config.mts',
  'forgemap.config.cts',
  'forgemap.config.js',
  'forgemap.config.mjs',
  'forgemap.config.cjs',
  'forgemap.config.json'
];

/** Walk up from `start` to the filesystem root looking for a forgemap config. */
function findConfigUp(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    for (const base of CONFIG_BASENAMES) {
      const candidate = join(dir, base);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Fallback config under $XDG_CONFIG_HOME/forgemap (or ~/.config/forgemap). */
function findGlobalConfig(): string | undefined {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const dir = join(base, 'forgemap');
  for (const baseName of CONFIG_BASENAMES) {
    const candidate = join(dir, baseName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Which of the four discovery steps produced the resolved config file:
 * `--config` flag → `FORGEMAP_CONFIG` env → walk-up from cwd → global fallback.
 * `default` means none matched and the built-in defaults are in effect.
 */
export type ConfigSource = 'flag' | 'env' | 'walk-up' | 'global' | 'default';

export interface LoadedConfig {
  config: ForgeMapConfig;
  configFile: string | undefined;
  cwd: string;
  /** The discovery step that found `configFile`, or `default` when none did. */
  source: ConfigSource;
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
  const startDir = options.cwd ?? process.cwd();
  // Resolution order: explicit flag → env → walk up from cwd → global fallback.
  // Track which step matched so callers (e.g. `info`) can report the origin.
  let explicit: string | undefined;
  let source: ConfigSource;
  if (options.configFile) {
    explicit = options.configFile;
    source = 'flag';
  } else if (envConfig) {
    explicit = envConfig;
    source = 'env';
  } else {
    const walkedUp = findConfigUp(startDir);
    if (walkedUp) {
      explicit = walkedUp;
      source = 'walk-up';
    } else {
      const global = findGlobalConfig();
      if (global) {
        explicit = global;
        source = 'global';
      } else {
        explicit = undefined;
        source = 'default';
      }
    }
  }
  const cwd = explicit ? dirname(explicit) : startDir;

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

  // When nothing was discovered, c12 still echoes back the fallback base name
  // ("forgemap.config") as `configFile` — a path that does not exist. Treat that
  // as "no file" so callers report the built-in defaults honestly.
  const resolvedFile =
    source === 'default' ? undefined : configFile || undefined;

  return {
    config: merged,
    configFile: resolvedFile,
    cwd,
    source: resolvedFile ? source : 'default'
  };
}
