import Fuse, { type IFuseOptions } from 'fuse.js';
import type { ScannedRepo } from './scan.ts';

/**
 * The one Fuse configuration every fuzzy lookup shares — `search`, `pick`
 * and the fuzzy slug fallback in `path`/`open`. Keeping it in one place is
 * what makes a query rank identically no matter which command runs it.
 */
export const REPO_FUSE_OPTIONS: IFuseOptions<ScannedRepo> = {
  keys: ['slug', 'owner', 'repo'],
  threshold: 0.3,
  ignoreLocation: true
};

export function createRepoFuse(repos: ScannedRepo[]): Fuse<ScannedRepo> {
  return new Fuse(repos, REPO_FUSE_OPTIONS);
}

/** Fuzzy-match `query` against scanned repos, best match first. */
export function matchRepos(
  repos: ScannedRepo[],
  query: string,
  limit?: number
): ScannedRepo[] {
  const fuse = createRepoFuse(repos);
  const results = fuse.search(query, limit ? { limit } : undefined);
  return results.map((r) => r.item);
}
