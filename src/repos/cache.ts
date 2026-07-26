import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'pathe';
import type { ForgeMapConfig } from '../config/schema.ts';
import { resolveRoot } from '../utils/path.ts';
import { type ScannedRepo, scanRepos } from './scan.ts';

/**
 * Cache lifecycle:
 *
 *   1. Hot path (age < TTL): trust the file, return repos directly.
 *      No stat calls, no fingerprint walk — ~1 ms.
 *
 *   2. Cold path (age ≥ TTL): walk the layout (in parallel) and compare
 *      against the stored fingerprint. On match, bump the timestamp and
 *      return cached repos. On mismatch, rescan and rewrite the cache.
 *
 *   3. Incremental updates (appendCachedRepo / removeCachedRepo):
 *      forgemap-driven changes (clone, remove) edit the cache in-place
 *      so the next read stays on the hot path. Used to skip rebuild
 *      when forgemap itself is the source of truth.
 *
 * Set FORGEMAP_CACHE_TTL_MS (default 60 000) to override the TTL.
 */
interface CacheFile {
  fingerprint: string;
  writtenAt: number;
  repos: ScannedRepo[];
}

const DEFAULT_TTL_MS = 60_000;

function ttl(): number {
  const env = process.env.FORGEMAP_CACHE_TTL_MS;
  if (!env) return DEFAULT_TTL_MS;
  const parsed = Number.parseInt(env, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TTL_MS;
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

/** `[path, marker]` — the marker is whatever identifies that level's state. */
type FingerprintEntry = [string, string];

/**
 * Fingerprint of the layout: directory mtimes for root, forge.dir and
 * every owner, plus the repo names each owner holds. Catches new clones
 * / removals at any of those levels. Stops short of stat-ing each repo
 * dir — that would mostly duplicate the scan it's meant to avoid.
 *
 * The repo names are what make the check reliable. An owner's mtime
 * alone is not enough: a repo cloned beside an existing one moves only
 * that mtime, and mtimes are compared at millisecond granularity, so
 * two clones landing inside the same millisecond hash identically and
 * a stale cache wins. Listing the names makes invalidation independent
 * of clock and filesystem timestamp resolution.
 *
 * Stats are issued in parallel: one batch per forge for its forge.dir +
 * owner list, all forges in parallel. Beats the sequential version by
 * an order of magnitude at thousands of owners.
 */
export async function computeFingerprint(
  config: ForgeMapConfig,
  configDir: string
): Promise<string> {
  const root = resolveRoot(config.root, configDir);

  const perForge = await Promise.all(
    Object.values(config.forges).map(async (forge) => {
      const forgeRoot = join(root, forge.dir);
      const [forgeMtime, owners] = await Promise.all([
        safeStat(forgeRoot),
        safeListDirs(forgeRoot)
      ]);
      const ownerEntries = await Promise.all(
        owners.map(async (owner) => {
          const ownerPath = join(forgeRoot, owner);
          const [mtime, repos] = await Promise.all([
            safeStat(ownerPath),
            safeListDirs(ownerPath)
          ]);
          // readdir order is filesystem-dependent — sort for a stable hash.
          // JSON quoting keeps names holding ':' or a newline unambiguous.
          const marker = `${mtime}:${JSON.stringify(repos.sort())}`;
          return [ownerPath, marker] as FingerprintEntry;
        })
      );
      return [
        [forgeRoot, String(forgeMtime)] as FingerprintEntry,
        ...ownerEntries
      ];
    })
  );

  const entries: FingerprintEntry[] = [[root, String(await safeStat(root))]];
  for (const group of perForge) entries.push(...group);

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return createHash('sha1')
    .update(entries.map(([p, marker]) => `${p}:${marker}`).join('\n'))
    .digest('hex');
}

async function readCacheFile(file: string): Promise<CacheFile | null> {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }
}

async function writeCacheFile(file: string, payload: CacheFile): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(file, JSON.stringify(payload), 'utf8');
}

export interface ScanCachedOptions {
  config: ForgeMapConfig;
  configDir: string;
  /** Default true. Set false to force a full re-scan and rewrite. */
  useCache?: boolean;
  /** Default true. Set false to skip the TTL fast-path and always validate the fingerprint. */
  trustTtl?: boolean;
}

export async function scanReposCached(
  options: ScanCachedOptions
): Promise<ScannedRepo[]> {
  const { config, configDir, useCache = true, trustTtl = true } = options;
  const root = resolveRoot(config.root, configDir);
  const file = cachePath(root);

  if (useCache) {
    const cached = await readCacheFile(file);
    if (cached) {
      const age = Date.now() - cached.writtenAt;
      if (trustTtl && age < ttl()) {
        return cached.repos;
      }
      const fingerprint = await computeFingerprint(config, configDir);
      if (cached.fingerprint === fingerprint) {
        // Still accurate — refresh the timestamp so the next reader can hot-path.
        await writeCacheFile(file, { ...cached, writtenAt: Date.now() });
        return cached.repos;
      }
    }
  }

  const repos = await scanRepos({ config, configDir });
  const fingerprint = await computeFingerprint(config, configDir);
  await writeCacheFile(file, {
    fingerprint,
    writtenAt: Date.now(),
    repos
  });
  return repos;
}

/**
 * Append a freshly-cloned repo to the cache without touching the
 * filesystem. Lets `forgemap clone` keep the cache warm so the next
 * read still hits the TTL fast-path.
 */
export async function appendCachedRepo(
  options: ScanCachedOptions,
  repo: ScannedRepo
): Promise<void> {
  const { config, configDir } = options;
  const root = resolveRoot(config.root, configDir);
  const file = cachePath(root);
  const cached = await readCacheFile(file);
  if (!cached) {
    return; // no cache yet — next scan will pick the new repo up naturally
  }
  if (cached.repos.some((r) => r.localPath === repo.localPath)) {
    return;
  }
  await writeCacheFile(file, {
    fingerprint: await computeFingerprint(config, configDir),
    writtenAt: Date.now(),
    repos: [...cached.repos, repo]
  });
}

/**
 * Inverse of appendCachedRepo for a future `forgemap remove`.
 */
export async function removeCachedRepo(
  options: ScanCachedOptions,
  localPath: string
): Promise<void> {
  const { config, configDir } = options;
  const root = resolveRoot(config.root, configDir);
  const file = cachePath(root);
  const cached = await readCacheFile(file);
  if (!cached) return;
  const next = cached.repos.filter((r) => r.localPath !== localPath);
  if (next.length === cached.repos.length) return;
  await writeCacheFile(file, {
    fingerprint: await computeFingerprint(config, configDir),
    writtenAt: Date.now(),
    repos: next
  });
}

// Exported for tests.
export const __test = { cacheDir, cachePath };
