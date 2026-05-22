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
