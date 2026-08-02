import type { ForgeType } from '../config/schema.ts';

/**
 * The on-disk layout is `<root>/<forge.dir>/<namespace…>/<repo>`, and the
 * namespace is as deep as the forge allows. These constants are the one place
 * that depth is bounded; the scanner and the slug resolver both read them so
 * a path the resolver accepts is a path the scanner can still find.
 */

/**
 * How many path segments below `<forge.dir>` the scanner will visit. Deeper
 * than any real namespace, shallow enough that a stray tree under `root` stops
 * the walk instead of paying for it. Deliberately *not* a config key: raising
 * it would paper over a layout problem rather than fix one.
 */
export const MAX_SCAN_DEPTH = 10;

/** A repo occupies the last segment, so the namespace gets the rest. */
export const MAX_NAMESPACE_DEPTH = MAX_SCAN_DEPTH - 1;

/**
 * The entry that marks a directory as a repo. A **file** counts as much as a
 * directory: linked worktrees and submodules record their git dir in a `.git`
 * file, and an `isDirectory()` test would skip them silently.
 */
export const GIT_MARKER = '.git';

/**
 * How many namespace segments a forge type accepts. GitHub, Gitea and Codeberg
 * have exactly one level of owner; GitLab nests arbitrarily, and `git` is the
 * documented fallback for a GitLab-shaped remote, so it nests too.
 */
export function namespaceDepthLimit(type: ForgeType): number {
  switch (type) {
    case 'gitlab':
    case 'git':
      return MAX_NAMESPACE_DEPTH;
    case 'github':
    case 'gitea':
    case 'codeberg':
      return 1;
  }
}

/**
 * Check a parsed namespace against the forge it was resolved to. Returns an
 * error message, or `null` when the depth is acceptable.
 *
 * This lives here rather than in `parseSlug` on purpose: the parser has no
 * forge, and keeping it pure is worth more than an earlier error message.
 */
export function checkNamespaceDepth(
  forgeName: string,
  type: ForgeType,
  namespace: string
): string | null {
  const depth = namespace.split('/').filter(Boolean).length;
  const limit = namespaceDepthLimit(type);
  if (depth <= limit) return null;
  if (limit === 1) {
    return `Forge "${forgeName}" (type ${type}) does not support nested namespaces: "${namespace}" has ${depth} segments, expected 1.`;
  }
  return `Namespace "${namespace}" is ${depth} segments deep; forgemap supports at most ${limit}.`;
}
