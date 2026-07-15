export interface ParsedSlug {
  /** Forge alias if explicitly specified via `<forge>:<owner>/<repo>` */
  forgeName?: string;
  /** Host if extracted from URL/SSH form */
  host?: string;
  owner: string;
  repo: string;
}

const SHORT_RE = /^([\w.-]+)\/([\w.-]+)$/;
const NAMED_RE = /^([\w.-]+):([\w.-]+)\/([\w.-]+)$/;
const SSH_RE = /^git@([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

/**
 * Whether the input is *shaped* like a strict slug. Every form
 * {@link parseSlug} accepts — `owner/repo`, `forge:owner/repo`, SSH and
 * URL — contains a `/`, so a bare term like `gild` can never be one and is
 * free to be treated as a fuzzy query instead.
 *
 * Shaped-like is deliberately not the same as valid: `foo/bar/baz` is shaped
 * like a slug, so it stays a hard parse error rather than silently degrading
 * into a fuzzy search for something the user clearly meant as a slug.
 */
export function looksLikeSlug(input: string): boolean {
  return input.trim().includes('/');
}

export function parseSlug(input: string): ParsedSlug {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Slug is empty');
  }

  // git@host:owner/repo(.git)
  const ssh = SSH_RE.exec(trimmed);
  if (ssh) {
    return {
      host: ssh[1],
      owner: ssh[2]!,
      repo: stripGitSuffix(ssh[3]!)
    };
  }

  // https://host/owner/repo(.git) or http://...
  if (/^https?:\/\//.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`Invalid URL: ${trimmed}`);
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error(`URL must contain owner and repo: ${trimmed}`);
    }
    return {
      host: url.host,
      owner: segments[0]!,
      repo: stripGitSuffix(segments[1]!)
    };
  }

  // forge:owner/repo
  const named = NAMED_RE.exec(trimmed);
  if (named) {
    return {
      forgeName: named[1],
      owner: named[2]!,
      repo: stripGitSuffix(named[3]!)
    };
  }

  // owner/repo
  const short = SHORT_RE.exec(trimmed);
  if (short) {
    return {
      owner: short[1]!,
      repo: stripGitSuffix(short[2]!)
    };
  }

  throw new Error(`Unrecognized slug format: ${input}`);
}
