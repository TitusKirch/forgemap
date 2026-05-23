import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'pathe';
import type { ForgeMapConfig } from '../config/schema.ts';
import { resolveRoot } from '../utils/path.ts';
import { type ScannedRepo, scanRepos } from './scan.ts';

interface CacheFile {
  fingerprint: string;
  repos: ScannedRepo[];
}

function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg ? join(xdg, 'forgemap') : join(homedir(), '.cache', 'forgemap');
}

function cachePath(root: string): string {
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 16);
  return join(cacheDir(), `scan-${hash}.json`);
}

async function safeStat(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return Math.trunc(s.mtimeMs);
  } catch {
    return 0;
  }
}

async function safeListDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Fingerprint of every directory mtime down to depth 3 (root, forge.dir,
 * owner). Catches new clones / removals at any of those levels. Stops
 * short of stat-ing each repo dir — that would mostly duplicate the
 * scan it's meant to avoid.
 */
export async function computeFingerprint(
  config: ForgeMapConfig,
  configDir: string
): Promise<string> {
  const root = resolveRoot(config.root, configDir);
  const entries: Array<[string, number]> = [];
  entries.push([root, await safeStat(root)]);

  for (const forge of Object.values(config.forges)) {
    const forgeRoot = join(root, forge.dir);
    entries.push([forgeRoot, await safeStat(forgeRoot)]);
    const owners = await safeListDirs(forgeRoot);
    for (const owner of owners) {
      const ownerPath = join(forgeRoot, owner);
      entries.push([ownerPath, await safeStat(ownerPath)]);
    }
  }

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return createHash('sha1')
    .update(entries.map(([p, m]) => `${p}:${m}`).join('\n'))
    .digest('hex');
}

export interface ScanCachedOptions {
  config: ForgeMapConfig;
  configDir: string;
  useCache?: boolean;
}

export async function scanReposCached(
  options: ScanCachedOptions
): Promise<ScannedRepo[]> {
  const { config, configDir, useCache = true } = options;
  const root = resolveRoot(config.root, configDir);
  const file = cachePath(root);
  const fingerprint = await computeFingerprint(config, configDir);

  if (useCache) {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.fingerprint === fingerprint) {
        return parsed.repos;
      }
    } catch {
      // missing or corrupt → fall through to a fresh scan
    }
  }

  const repos = await scanRepos({ config, configDir });
  await mkdir(cacheDir(), { recursive: true });
  const payload: CacheFile = { fingerprint, repos };
  await writeFile(file, JSON.stringify(payload), 'utf8');
  return repos;
}

// Exported for tests.
export const __test = { cacheDir, cachePath };
