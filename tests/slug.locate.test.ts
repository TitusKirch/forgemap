import { describe, expect, it } from 'vitest';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import type { ScannedRepo } from '../src/repos/scan.ts';
import { locateRepo } from '../src/slug/locate.ts';

const config: ForgeMapConfig = {
  root: '/tmp/projects',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
  }
};

function repo(forgeName: string, owner: string, name: string): ScannedRepo {
  const forge = config.forges[forgeName]!;
  return {
    forgeName,
    forge,
    owner,
    repo: name,
    localPath: `/tmp/projects/${forge.dir}/${owner}/${name}`,
    slug: `${owner}/${name}`
  };
}

const repos: ScannedRepo[] = [
  repo('github', 'kirchDev', 'gildmaster'),
  repo('github', 'kirchDev', 'laravel-pbac'),
  repo('github', 'acme', 'gildhall'),
  repo('work', 'team', 'api')
];

const options = { config, configDir: '/cfg', repos };

describe('locateRepo', () => {
  it('resolves a strict short slug without consulting disk', async () => {
    const out = await locateRepo('kirchDev/laravel-pbac', options);
    expect(out).toEqual({
      kind: 'slug',
      localPath: '/tmp/projects/comGithub/kirchDev/laravel-pbac'
    });
  });

  it('resolves a strict slug for a repo that is not cloned', async () => {
    const out = await locateRepo('someone/not-cloned', options);
    expect(out.kind).toBe('slug');
    expect(out).toHaveProperty(
      'localPath',
      '/tmp/projects/comGithub/someone/not-cloned'
    );
  });

  it('resolves a named forge slug', async () => {
    const out = await locateRepo('work:team/api', options);
    expect(out).toEqual({
      kind: 'slug',
      localPath: '/tmp/projects/comGitlabAcme/team/api'
    });
  });

  it('resolves a full URL', async () => {
    const out = await locateRepo('https://github.com/foo/bar.git', options);
    expect(out).toEqual({
      kind: 'slug',
      localPath: '/tmp/projects/comGithub/foo/bar'
    });
  });

  it('falls back to fuzzy matching for a bare term', async () => {
    const out = await locateRepo('gildmaster', options);
    expect(out.kind).toBe('match');
    expect(out).toHaveProperty(
      'localPath',
      '/tmp/projects/comGithub/kirchDev/gildmaster'
    );
  });

  it('reports every candidate when a fuzzy term is ambiguous', async () => {
    const out = await locateRepo('gild', options);
    expect(out.kind).toBe('ambiguous');
    if (out.kind !== 'ambiguous') throw new Error('expected ambiguous');
    expect(out.query).toBe('gild');
    expect(out.candidates.map((c) => c.slug).sort()).toEqual([
      'acme/gildhall',
      'kirchDev/gildmaster'
    ]);
  });

  it('reports no match for a term that hits nothing', async () => {
    const out = await locateRepo('zzzznope', options);
    expect(out).toEqual({ kind: 'none', query: 'zzzznope' });
  });

  it('prefers an exact strict slug over any fuzzy match', async () => {
    // `gild` alone is ambiguous, but the strict form must never fuzzy-match.
    const out = await locateRepo('acme/gildhall', options);
    expect(out).toEqual({
      kind: 'slug',
      localPath: '/tmp/projects/comGithub/acme/gildhall'
    });
  });

  it('throws on a malformed slug rather than fuzzy-matching it', async () => {
    await expect(locateRepo('foo/bar/baz', options)).rejects.toThrow(
      /Unrecognized/
    );
  });

  it('throws on empty input', async () => {
    await expect(locateRepo('   ', options)).rejects.toThrow(/empty/);
  });
});
