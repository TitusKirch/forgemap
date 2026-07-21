import type { ScannedRepo } from './scan.ts';

const FLAG = '--filter';

/**
 * Shared `--filter` option for the commands that enumerate repos
 * (`status`, `sync`, `list`), so the flag reads identically everywhere.
 */
export const filterArg = {
  type: 'string',
  description:
    'Restrict to repos whose owner or forge name matches. Repeatable; a repo passes if it matches any value.'
} as const;

/**
 * Recover every `--filter` occurrence from the raw argv.
 *
 * citty (0.2.2) parses through `node:util` `parseArgs` and never sets
 * `multiple: true`, so Node keeps only the **last** value of a repeated option:
 * `--filter a --filter b` reaches `args.filter` as `'b'`, silently dropping
 * `a`. The raw argv is the only place the full list survives.
 */
export function collectFilterArgs(rawArgs: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    // Everything past `--` is positional, not ours to read.
    if (arg === '--') break;
    if (arg === FLAG) {
      const next = rawArgs[i + 1];
      // A bare trailing `--filter`, or `--filter --json`, has no value.
      if (next !== undefined && !next.startsWith('-')) {
        values.push(next);
        i++;
      }
      continue;
    }
    if (arg.startsWith(`${FLAG}=`)) values.push(arg.slice(FLAG.length + 1));
  }
  return values;
}

/**
 * Normalize the shapes a filter value arrives in — absent, a single string, or
 * a list — into a list, dropping blanks (`--filter ''`).
 */
export function normalizeFilters(
  value: string | string[] | undefined
): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * The filter values for a run: the raw argv wins, since it is the only shape
 * that survives repetition. Fall back to the parsed value when the argv carries
 * no `--filter` at all, which is how the command is driven programmatically
 * (and in tests), where `rawArgs` may be empty.
 */
export function resolveFilters(
  rawArgs: string[],
  value: string | string[] | undefined
): string[] {
  const fromRawArgs = collectFilterArgs(rawArgs);
  return normalizeFilters(fromRawArgs.length > 0 ? fromRawArgs : value);
}

/**
 * Keep the repos matching any of `filters` (OR-combined). A value matches when
 * it equals the repo's owner or its forge name, compared case-insensitively —
 * forge and owner names are case-preserving but not case-significant. An empty
 * filter list is a no-op, so an unused flag never narrows the output.
 */
export function filterRepos(
  repos: ScannedRepo[],
  filters: string[]
): ScannedRepo[] {
  if (filters.length === 0) return repos;
  const wanted = new Set(filters.map((f) => f.toLowerCase()));
  return repos.filter(
    (r) =>
      wanted.has(r.owner.toLowerCase()) || wanted.has(r.forgeName.toLowerCase())
  );
}
