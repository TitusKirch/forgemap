import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'pathe';

/** The npm package this CLI ships as — the `self-update` target. */
export const PACKAGE_NAME = 'forgemap';

/** `linked` = runs from a git work tree; `release` = an installed package. */
export type BuildKind = 'linked' | 'release' | 'unknown';

export interface BuildInfo {
  kind: BuildKind;
  /** Directory of the nearest `forgemap` package.json above the binary. */
  packageRoot: string | null;
  reason: string;
}

export interface BinaryInfo {
  /** The path as invoked (may be a shim / symlink). */
  invoked: string | null;
  /** The real executed file, symlinks resolved. */
  resolved: string | null;
}

/** Resolve the real executed file behind any shim or symlink. */
export function resolveBinary(entry: string | undefined): BinaryInfo {
  if (!entry) return { invoked: null, resolved: null };
  try {
    return { invoked: entry, resolved: realpathSync(entry) };
  } catch {
    // The file vanished (or is unreadable) — report the invoked path as-is
    // rather than failing; `info` describes, it never judges.
    return { invoked: entry, resolved: entry };
  }
}

/** Walk up from `start` to the nearest package.json, returning its dir + name. */
export function findPackageRoot(
  start: string
): { dir: string; name: string | undefined } | null {
  let dir = resolve(start);
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          name?: string;
        };
        return { dir, name: pkg.name };
      } catch {
        return { dir, name: undefined };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Distinguish a linked/dev build from an installed release: the resolved binary
 * lives inside a git work tree whose package.json is named `forgemap`. An
 * installed package has the same package.json but no `.git` beside it. When the
 * binary or a `forgemap` package.json cannot be located, report `unknown`
 * rather than guessing.
 */
export function detectBuild(resolved: string | null): BuildInfo {
  if (!resolved) {
    return {
      kind: 'unknown',
      packageRoot: null,
      reason: 'binary path could not be resolved'
    };
  }
  const pkg = findPackageRoot(dirname(resolved));
  if (!pkg) {
    return {
      kind: 'unknown',
      packageRoot: null,
      reason: 'no package.json found above the binary'
    };
  }
  if (pkg.name !== PACKAGE_NAME) {
    return {
      kind: 'unknown',
      packageRoot: pkg.dir,
      reason: `nearest package.json is "${pkg.name ?? 'unnamed'}", not ${PACKAGE_NAME}`
    };
  }
  // Check `.git` only at the forgemap package root, never above it: an installed
  // package under a consumer's node_modules would otherwise inherit that repo's
  // .git and be mislabelled as linked.
  const inGitTree = existsSync(join(pkg.dir, '.git'));
  return {
    kind: inGitTree ? 'linked' : 'release',
    packageRoot: pkg.dir,
    reason: inGitTree
      ? `runs from a git work tree named ${PACKAGE_NAME}`
      : `installed ${PACKAGE_NAME} package (no git work tree beside it)`
  };
}
