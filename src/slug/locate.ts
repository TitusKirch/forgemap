import consola from 'consola';
import { colors } from 'consola/utils';
import type { ForgeMapConfig } from '../config/schema.ts';
import { matchRepos } from '../repos/match.ts';
import { canPrompt, promptRepoChoice } from '../repos/picker.ts';
import { type ScannedRepo, scanRepos } from '../repos/scan.ts';
import { looksLikeSlug, type ParsedSlug, parseSlug } from './parse.ts';
import { type ResolvedSlug, resolveSlug } from './resolve.ts';

export interface LocateOptions {
  config: ForgeMapConfig;
  configDir: string;
  /** Pre-scanned repos. Scanned on demand when omitted. */
  repos?: ScannedRepo[];
  /**
   * Only ever resolve to a repo that is actually cloned. A strict slug whose
   * layout path holds no repo is then looked up by namespace and name across
   * every forge — or across the named one, when the slug names a forge — so
   * `cd` lands where the repo lives instead of on a path that doesn't exist.
   */
  cloned?: boolean;
}

export type LocateOutcome =
  /** Input was a strict slug — resolved by layout, cloned or not. */
  | { kind: 'slug'; localPath: string }
  /** Fuzzy query hit exactly one cloned repo. */
  | { kind: 'match'; localPath: string; repo: ScannedRepo }
  /** Fuzzy query hit several cloned repos. */
  | { kind: 'ambiguous'; query: string; candidates: ScannedRepo[] }
  /** Fuzzy query hit nothing. */
  | { kind: 'none'; query: string };

/**
 * Turn user input into a repo location.
 *
 * A strict slug is resolved from the configured layout and never consults the
 * disk — so an explicit `owner/repo` always wins over any fuzzy match, and
 * still resolves for a repo that isn't cloned yet. Only input that cannot be a
 * slug at all falls back to fuzzy-matching the cloned repos.
 *
 * Throws for malformed *slugs* (`foo/bar/baz`, a bad URL, empty input) — those
 * are mistakes to report, not queries to guess at.
 */
export async function locateRepo(
  input: string,
  options: LocateOptions
): Promise<LocateOutcome> {
  const { config, configDir } = options;

  if (!input.trim() || looksLikeSlug(input)) {
    const parsed = parseSlug(input);
    if (!options.cloned) {
      const resolved = resolveSlug(parsed, { config, configDir });
      return { kind: 'slug', localPath: resolved.localPath };
    }
    return locateClonedSlug(input, parsed, options);
  }

  const repos = options.repos ?? (await scanRepos({ config, configDir }));
  const candidates = matchRepos(repos, input);

  if (candidates.length === 0) return { kind: 'none', query: input };
  if (candidates.length === 1) {
    return {
      kind: 'match',
      localPath: candidates[0]!.localPath,
      repo: candidates[0]!
    };
  }
  return { kind: 'ambiguous', query: input, candidates };
}

/**
 * The `cloned` half of {@link locateRepo} for a strict slug: the layout path
 * wins when it holds a repo, otherwise every cloned repo with the same
 * namespace and name is a candidate. Without an explicit forge the slug isn't
 * bound to the default one, so a namespace too deep for it is no error yet —
 * it may well be cloned under a forge whose namespaces nest.
 */
async function locateClonedSlug(
  input: string,
  parsed: ParsedSlug,
  options: LocateOptions
): Promise<LocateOutcome> {
  const { config, configDir } = options;
  const explicit = Boolean(parsed.forgeName ?? parsed.host);

  let resolved: ResolvedSlug | undefined;
  try {
    resolved = resolveSlug(parsed, { config, configDir });
  } catch (error) {
    if (explicit) throw error;
  }

  const repos = options.repos ?? (await scanRepos({ config, configDir }));
  const exact =
    resolved && repos.find((r) => r.localPath === resolved.localPath);
  if (exact) return { kind: 'slug', localPath: exact.localPath };

  const candidates = repos.filter(
    (r) =>
      r.owner === parsed.owner &&
      r.repo === parsed.repo &&
      (!explicit || r.forgeName === resolved?.forgeName)
  );

  if (candidates.length === 1) {
    return {
      kind: 'match',
      localPath: candidates[0]!.localPath,
      repo: candidates[0]!
    };
  }
  if (candidates.length > 1) {
    return { kind: 'ambiguous', query: input, candidates };
  }
  // Nothing cloned anywhere: surface the depth error the default forge raised,
  // since that is the more useful explanation than "no match".
  if (!resolved) resolveSlug(parsed, { config, configDir });
  return { kind: 'none', query: input };
}

/**
 * {@link locateRepo} plus the interactive/diagnostic layer shared by `path`
 * and `open`: prompt on an ambiguous query when there is a TTY to prompt on,
 * otherwise explain and fail. Returns null when nothing was resolved — the
 * caller sets the exit code.
 *
 * Every diagnostic goes to stderr: `$(forgemap path <q>)` captures stdout, and
 * a hint leaking into that capture would be read as a path.
 */
export async function resolveRepoPath(
  input: string,
  options: LocateOptions
): Promise<string | null> {
  const outcome = await locateRepo(input, options);

  switch (outcome.kind) {
    case 'slug':
    case 'match':
      return outcome.localPath;

    case 'none':
      consola.error(`No cloned repo matches "${outcome.query}".`);
      process.stderr.write(
        `${colors.dim(
          options.cloned
            ? 'Clone it first with `forgemap clone <owner>/<repo>`.'
            : 'Pass an explicit <owner>/<repo> for a repo that is not cloned yet.'
        )}\n`
      );
      return null;

    case 'ambiguous': {
      if (canPrompt()) {
        return (await promptRepoChoice(outcome.candidates)) ?? null;
      }
      consola.error(
        `"${outcome.query}" matches ${outcome.candidates.length} cloned repos:`
      );
      for (const c of outcome.candidates) {
        process.stderr.write(
          `  ${colors.cyan(`${c.forgeName}:${c.slug}`)}  ${colors.dim(c.localPath)}\n`
        );
      }
      process.stderr.write(
        `${colors.dim('Narrow the query, pass an explicit <owner>/<repo>, or run `forgemap pick` to choose interactively.')}\n`
      );
      return null;
    }
  }
}
