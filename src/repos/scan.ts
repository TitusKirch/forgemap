import { readdir } from 'node:fs/promises';
import { join } from 'pathe';
import type { ForgeConfig, ForgeMapConfig } from '../config/schema.ts';
import { resolveRoot } from '../utils/path.ts';

export interface ScannedRepo {
  forgeName: string;
  forge: ForgeConfig;
  owner: string;
  repo: string;
  localPath: string;
  /** Convenience: `<owner>/<repo>` */
  slug: string;
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export interface ScanOptions {
  config: ForgeMapConfig;
  configDir: string;
}

export async function scanRepos(options: ScanOptions): Promise<ScannedRepo[]> {
  const { config, configDir } = options;
  const root = resolveRoot(config.root, configDir);
  const repos: ScannedRepo[] = [];

  for (const [forgeName, forge] of Object.entries(config.forges)) {
    const forgeRoot = join(root, forge.dir);
    const owners = await listDirs(forgeRoot);
    for (const owner of owners) {
      const ownerPath = join(forgeRoot, owner);
      const repoNames = await listDirs(ownerPath);
      for (const repo of repoNames) {
        repos.push({
          forgeName,
          forge,
          owner,
          repo,
          localPath: join(ownerPath, repo),
          slug: `${owner}/${repo}`
        });
      }
    }
  }

  return repos;
}
