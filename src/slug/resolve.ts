import { join } from 'pathe';
import type { ForgeConfig, ForgeMapConfig } from '../config/schema.ts';
import { resolveRoot } from '../utils/path.ts';
import type { ParsedSlug } from './parse.ts';

export interface ResolvedSlug {
  forgeName: string;
  forge: ForgeConfig;
  owner: string;
  repo: string;
  localPath: string;
}

export interface ResolveOptions {
  config: ForgeMapConfig;
  configDir: string;
}

function findForgeByHost(
  forges: ForgeMapConfig['forges'],
  host: string
): { name: string; forge: ForgeConfig } | undefined {
  for (const [name, forge] of Object.entries(forges)) {
    if (forge.host.toLowerCase() === host.toLowerCase()) {
      return { name, forge };
    }
  }
  return undefined;
}

export function resolveSlug(
  parsed: ParsedSlug,
  options: ResolveOptions
): ResolvedSlug {
  const { config, configDir } = options;

  let forgeName: string;
  let forge: ForgeConfig;

  if (parsed.forgeName) {
    const candidate = config.forges[parsed.forgeName];
    if (!candidate) {
      throw new Error(
        `Forge "${parsed.forgeName}" is not defined in forgemap.config`
      );
    }
    forgeName = parsed.forgeName;
    forge = candidate;
  } else if (parsed.host) {
    const match = findForgeByHost(config.forges, parsed.host);
    if (!match) {
      throw new Error(
        `No forge configured for host "${parsed.host}". Add it to forgemap.config.ts.`
      );
    }
    forgeName = match.name;
    forge = match.forge;
  } else {
    const candidate = config.forges[config.defaultForge];
    if (!candidate) {
      throw new Error(
        `Default forge "${config.defaultForge}" is not defined in forgemap.config`
      );
    }
    forgeName = config.defaultForge;
    forge = candidate;
  }

  const root = resolveRoot(config.root, configDir);
  const localPath = join(root, forge.dir, parsed.owner, parsed.repo);

  return {
    forgeName,
    forge,
    owner: parsed.owner,
    repo: parsed.repo,
    localPath
  };
}
