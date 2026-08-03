import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Mark an existing directory as a repo the way the scanner recognises one: by
 * the `.git` entry inside it. A plain directory under a forge dir is not a
 * repo, so tests that only need a *path* must still put the marker there.
 */
export async function markRepo(path: string): Promise<string> {
  await mkdir(join(path, '.git'), { recursive: true });
  return path;
}

/** Create a repo checkout at `segments` below `root`. Returns its path. */
export async function seedRepo(
  root: string,
  ...segments: string[]
): Promise<string> {
  return markRepo(join(root, ...segments));
}
