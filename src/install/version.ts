/**
 * Just enough semver to answer "is the installed version behind the registry's
 * `latest`" — the only question asked of it, which is why this is ~30 lines
 * instead of a dependency. Build metadata (`+…`) is ignored, as semver says it
 * must be for precedence.
 */
interface Parsed {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a release. */
  pre: string[];
}

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): Parsed | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : []
  };
}

function sign(delta: number): number {
  return delta === 0 ? 0 : delta < 0 ? -1 : 1;
}

/** Semver precedence for prerelease identifiers: a release outranks any
 *  prerelease, numeric identifiers rank below alphanumeric ones, and a shorter
 *  run of otherwise equal identifiers ranks lower. */
function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const delta = sign(Number(left) - Number(right));
      if (delta !== 0) return delta;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** `-1` when `a` precedes `b`, `0` when equal, `1` when `a` is newer. */
export function compareVersions(a: Parsed, b: Parsed): number {
  return (
    sign(a.major - b.major) ||
    sign(a.minor - b.minor) ||
    sign(a.patch - b.patch) ||
    comparePre(a.pre, b.pre)
  );
}

/**
 * Whether `current` is older than `latest`. An unparsable version on either
 * side answers `false` — a malformed registry reply must never be able to claim
 * an update exists, and the caller reports being up to date rather than acting
 * on a version it could not read.
 */
export function isOutdated(current: string, latest: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  return compareVersions(a, b) < 0;
}
