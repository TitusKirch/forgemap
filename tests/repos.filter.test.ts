import { describe, expect, it } from 'vitest';
import {
  collectFilterArgs,
  filterRepos,
  normalizeFilters,
  resolveFilters
} from '../src/repos/filter.ts';
import type { ScannedRepo } from '../src/repos/scan.ts';

function repo(forgeName: string, owner: string, name: string): ScannedRepo {
  return {
    forgeName,
    forge: { type: 'github', host: 'github.com', dir: 'comGithub' } as never,
    owner,
    repo: name,
    localPath: `/root/projects/${forgeName}/${owner}/${name}`,
    slug: `${owner}/${name}`
  };
}

const REPOS: ScannedRepo[] = [
  repo('github', 'kirchDev', 'laravel-pbac'),
  repo('github', 'TitusKirch', 'forgemap'),
  repo('github', 'vercel', 'next.js'),
  repo('work', 'team', 'api')
];

describe('collectFilterArgs', () => {
  it('finds nothing when the flag is absent', () => {
    expect(collectFilterArgs(['--format', 'json'])).toEqual([]);
  });

  it('collects every occurrence of a repeated flag', () => {
    expect(
      collectFilterArgs([
        '--format',
        'json',
        '--filter',
        'kirchDev',
        '--filter',
        'TitusKirch'
      ])
    ).toEqual(['kirchDev', 'TitusKirch']);
  });

  it('collects the --filter=value form', () => {
    expect(
      collectFilterArgs(['--filter=kirchDev', '--filter=TitusKirch'])
    ).toEqual(['kirchDev', 'TitusKirch']);
  });

  it('does not swallow a following flag as a value', () => {
    expect(collectFilterArgs(['--filter', '--format', 'json'])).toEqual([]);
  });

  it('ignores a bare trailing --filter', () => {
    expect(collectFilterArgs(['--format', 'json', '--filter'])).toEqual([]);
  });

  it('stops reading at the -- separator', () => {
    expect(collectFilterArgs(['--filter', 'a', '--', '--filter', 'b'])).toEqual(
      ['a']
    );
  });
});

describe('resolveFilters', () => {
  it('prefers the raw argv, which is the only shape that survives repetition', () => {
    // citty collapses `--filter a --filter b` to 'b' by the time it hits args.
    expect(resolveFilters(['--filter', 'a', '--filter', 'b'], 'b')).toEqual([
      'a',
      'b'
    ]);
  });

  it('falls back to the parsed value when the argv has no --filter', () => {
    expect(resolveFilters([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(resolveFilters([], 'a')).toEqual(['a']);
  });

  it('is empty when neither source carries a value', () => {
    expect(resolveFilters([], undefined)).toEqual([]);
  });
});

describe('normalizeFilters', () => {
  it('maps an absent flag to an empty list', () => {
    expect(normalizeFilters(undefined)).toEqual([]);
  });

  it('wraps a single occurrence into a list', () => {
    expect(normalizeFilters('kirchDev')).toEqual(['kirchDev']);
  });

  it('keeps a repeated occurrence as-is', () => {
    expect(normalizeFilters(['kirchDev', 'TitusKirch'])).toEqual([
      'kirchDev',
      'TitusKirch'
    ]);
  });

  it('trims values and drops blank ones', () => {
    expect(normalizeFilters([' kirchDev ', '', '   '])).toEqual(['kirchDev']);
  });
});

describe('filterRepos', () => {
  it('is a no-op for an empty filter list', () => {
    expect(filterRepos(REPOS, [])).toEqual(REPOS);
  });

  it('matches against the owner', () => {
    expect(filterRepos(REPOS, ['kirchDev']).map((r) => r.slug)).toEqual([
      'kirchDev/laravel-pbac'
    ]);
  });

  it('OR-combines repeated values', () => {
    expect(
      filterRepos(REPOS, ['kirchDev', 'TitusKirch']).map((r) => r.slug)
    ).toEqual(['kirchDev/laravel-pbac', 'TitusKirch/forgemap']);
  });

  it('matches against the forge name too', () => {
    expect(filterRepos(REPOS, ['work']).map((r) => r.slug)).toEqual([
      'team/api'
    ]);
  });

  it('matches case-insensitively', () => {
    expect(
      filterRepos(REPOS, ['kirchdev', 'TITUSKIRCH']).map((r) => r.owner)
    ).toEqual(['kirchDev', 'TitusKirch']);
  });

  it('matches a whole name, not a substring', () => {
    expect(filterRepos(REPOS, ['kirch'])).toEqual([]);
  });

  it('returns nothing when no value matches', () => {
    expect(filterRepos(REPOS, ['nobody'])).toEqual([]);
  });
});
