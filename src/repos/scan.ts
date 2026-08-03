import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'pathe';
import type { ForgeConfig, ForgeMapConfig } from '../config/schema.ts';
import { mapLimit } from '../utils/concurrency.ts';
import { resolveRoot } from '../utils/path.ts';
import { GIT_MARKER, MAX_SCAN_DEPTH } from './layout.ts';

export interface ScannedRepo {
  forgeName: string;
  forge: ForgeConfig;
  /** Namespace path — one segment on a flat forge, several where they nest. */
  owner: string;
  repo: string;
  localPath: string;
  /** Convenience: `<namespace…>/<repo>` */
  slug: string;
}

/** Why a directory under a forge dir yielded no repo. Surfaced by `validate`. */
export type ScanHintReason =
  /** The branch dead-ends without ever reaching a `.git`. */
  | 'no-repo'
  /** A repo directly under the forge dir, with no namespace above it. */
  | 'missing-namespace'
  /** The branch is deeper than {@link MAX_SCAN_DEPTH}, so the walk stopped. */
  | 'too-deep';

export interface ScanHint {
  path: string;
  reason: ScanHintReason;
}

export interface LayoutScan {
  repos: ScannedRepo[];
  /** Branches that yielded nothing — a diagnostic, never part of `repos`. */
  hints: ScanHint[];
  /** Hash of the observed layout, consumed by the scan cache. */
  fingerprint: string;
}

export interface ScanOptions {
  config: ForgeMapConfig;
  configDir: string;
}

const WALK_CONCURRENCY = 32;

/** `[path, marker]` — the marker is whatever identifies that level's state. */
type FingerprintEntry = [string, string];

interface DirEntries {
  /** Child directories, dotfiles excluded — the only ones worth descending. */
  dirs: string[];
  /** Whether a `.git` entry sits here, file or directory alike. */
  isRepo: boolean;
}

async function readEntries(path: string): Promise<DirEntries | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return {
      dirs: entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name),
      isRepo: entries.some((e) => e.name === GIT_MARKER)
    };
  } catch {
    return null;
  }
}

async function safeStat(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return Math.trunc(s.mtimeMs);
  } catch {
    return 0;
  }
}

interface WalkContext {
  forgeName: string;
  forge: ForgeConfig;
  repos: ScannedRepo[];
  hints: ScanHint[];
  entries: FingerprintEntry[];
}

/**
 * One rule for every forge type: a directory holding a `.git` entry **is** a
 * repo, and everything above it is namespace. The walk stops at the first
 * marker and never descends into a repo, which keeps submodules and nested
 * checkouts out without a special case for either.
 *
 * `segments` is the path accumulated below the forge dir; the repo takes the
 * last one and the namespace the rest, so a repo needs at least two.
 *
 * The cap counts those segments inclusive of the repo's own — a namespace at
 * exactly MAX_NAMESPACE_DEPTH must still have its repo visited, or the
 * resolver would accept a path the scanner can never find.
 */
async function walk(
  ctx: WalkContext,
  dirPath: string,
  segments: string[]
): Promise<void> {
  if (segments.length > MAX_SCAN_DEPTH) {
    ctx.hints.push({ path: dirPath, reason: 'too-deep' });
    return;
  }

  const entries = await readEntries(dirPath);
  if (!entries) {
    // A forge dir that does not exist yet is normal; anything deeper is a
    // branch the user expected to hold something.
    if (segments.length === 0) ctx.entries.push([dirPath, 'd:0:[]']);
    else ctx.hints.push({ path: dirPath, reason: 'no-repo' });
    return;
  }

  if (entries.isRepo) {
    ctx.entries.push([dirPath, 'r']);
    if (segments.length < 2) {
      ctx.hints.push({ path: dirPath, reason: 'missing-namespace' });
      return;
    }
    const owner = segments.slice(0, -1).join('/');
    const repo = segments.at(-1)!;
    ctx.repos.push({
      forgeName: ctx.forgeName,
      forge: ctx.forge,
      owner,
      repo,
      localPath: dirPath,
      slug: `${owner}/${repo}`
    });
    return;
  }

  // readdir order is filesystem-dependent — sort for a stable hash. JSON
  // quoting keeps names holding ':' or a newline unambiguous.
  const names = [...entries.dirs].sort();
  const mtime = await safeStat(dirPath);
  ctx.entries.push([dirPath, `d:${mtime}:${JSON.stringify(names)}`]);

  if (names.length === 0) {
    if (segments.length > 0) {
      ctx.hints.push({ path: dirPath, reason: 'no-repo' });
    }
    return;
  }

  await mapLimit(names, WALK_CONCURRENCY, (name) =>
    walk(ctx, join(dirPath, name), [...segments, name])
  );
}

/**
 * Walk the configured layout once, producing the repos, the branches that
 * yielded none, and a fingerprint of what was observed.
 *
 * The fingerprint records each namespace directory's mtime **and** its sorted
 * child names, plus which directories turned out to be repos. The names are
 * what make it reliable: mtimes compare at millisecond granularity, so two
 * clones landing inside the same millisecond hash identically and a stale
 * cache would win. Recording the repo classification is what catches a plain
 * directory becoming a checkout (`git init`) without any name moving at all.
 */
export async function scanLayout(options: ScanOptions): Promise<LayoutScan> {
  const { config, configDir } = options;
  const root = resolveRoot(config.root, configDir);

  const contexts = await mapLimit(
    Object.entries(config.forges),
    WALK_CONCURRENCY,
    async ([forgeName, forge]) => {
      const ctx: WalkContext = {
        forgeName,
        forge,
        repos: [],
        hints: [],
        entries: []
      };
      await walk(ctx, join(root, forge.dir), []);
      return ctx;
    }
  );

  const entries: FingerprintEntry[] = [[root, `m:${await safeStat(root)}`]];
  const repos: ScannedRepo[] = [];
  const hints: ScanHint[] = [];
  for (const ctx of contexts) {
    repos.push(...ctx.repos);
    hints.push(...ctx.hints);
    entries.push(...ctx.entries);
  }

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const fingerprint = createHash('sha1')
    .update(entries.map(([p, marker]) => `${p}:${marker}`).join('\n'))
    .digest('hex');

  return { repos, hints, fingerprint };
}

export async function scanRepos(options: ScanOptions): Promise<ScannedRepo[]> {
  return (await scanLayout(options)).repos;
}
