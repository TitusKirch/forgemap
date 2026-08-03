export interface ParsedSlug {
  /** Forge alias if explicitly specified via `<forge>:<namespace>/<repo>` */
  forgeName?: string;
  /** Host if extracted from URL/SSH form */
  host?: string;
  /**
   * Everything before the repo segment, joined with `/`: one segment on a flat
   * forge (`kirchDev`), several on one whose namespaces nest (`group/sub`).
   * How deep it may go depends on the forge, which this parser deliberately
   * knows nothing about — {@link ../slug/resolve.ts} binds the two and checks.
   */
  owner: string;
  repo: string;
}

const SEGMENT = String.raw`[\w.-]+`;
const SHORT_RE = new RegExp(`^(${SEGMENT}(?:/${SEGMENT})*)/(${SEGMENT})$`);
const NAMED_RE = new RegExp(
  `^(${SEGMENT}):(${SEGMENT}(?:/${SEGMENT})*)/(${SEGMENT})$`
);
const SSH_RE = new RegExp(
  `^git@(${SEGMENT}):(${SEGMENT}(?:/${SEGMENT})*)/(${SEGMENT}?)(?:\\.git)?$`
);

function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

/**
 * Split `<namespace…>/<repo>` into its two halves: the **last** segment is the
 * repo, everything before it the namespace. Collapses to today's result
 * whenever there are exactly two segments.
 */
function splitPath(segments: string[]): { owner: string; repo: string } {
  return {
    owner: segments.slice(0, -1).join('/'),
    repo: stripGitSuffix(segments.at(-1)!)
  };
}

/**
 * Whether the input is *shaped* like a strict slug. Every form
 * {@link parseSlug} accepts — `namespace/repo`, `forge:namespace/repo`, SSH
 * and URL — contains a `/`, so a bare term like `gild` can never be one and is
 * free to be treated as a fuzzy query instead.
 */
export function looksLikeSlug(input: string): boolean {
  return input.trim().includes('/');
}

export function parseSlug(input: string): ParsedSlug {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Slug is empty');
  }

  // git@host:namespace…/repo(.git)
  const ssh = SSH_RE.exec(trimmed);
  if (ssh) {
    return {
      host: ssh[1],
      ...splitPath([...ssh[2]!.split('/'), ssh[3]!])
    };
  }

  // https://host/namespace…/repo(.git) or http://...
  if (/^https?:\/\//.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`Invalid URL: ${trimmed}`);
    }
    let segments = url.pathname.split('/').filter(Boolean);
    // GitLab hangs everything the web UI offers off a `/-/` separator
    // (`…/repo/-/merge_requests/1`). Pasting from the browser is why the URL
    // form exists at all, so cut there rather than parsing the tail.
    const separator = segments.indexOf('-');
    if (separator !== -1) segments = segments.slice(0, separator);
    if (segments.length < 2) {
      throw new Error(`URL must contain a namespace and repo: ${trimmed}`);
    }
    return { host: url.host, ...splitPath(segments) };
  }

  // forge:namespace…/repo
  const named = NAMED_RE.exec(trimmed);
  if (named) {
    return {
      forgeName: named[1],
      ...splitPath([...named[2]!.split('/'), named[3]!])
    };
  }

  // namespace…/repo
  const short = SHORT_RE.exec(trimmed);
  if (short) {
    return splitPath([...short[1]!.split('/'), short[2]!]);
  }

  throw new Error(`Unrecognized slug format: ${input}`);
}
