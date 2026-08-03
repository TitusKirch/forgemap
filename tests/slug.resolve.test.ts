import { describe, expect, it } from 'vitest';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import { parseSlug } from '../src/slug/parse.ts';
import { resolveSlug } from '../src/slug/resolve.ts';

const config: ForgeMapConfig = {
  root: '/tmp/projects',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
  }
};

describe('resolveSlug', () => {
  it('uses default forge for short slug', () => {
    const r = resolveSlug(parseSlug('foo/bar'), { config, configDir: '/cfg' });
    expect(r.forgeName).toBe('github');
    expect(r.localPath).toBe('/tmp/projects/comGithub/foo/bar');
  });

  it('uses named forge', () => {
    const r = resolveSlug(parseSlug('work:team/api'), {
      config,
      configDir: '/cfg'
    });
    expect(r.forgeName).toBe('work');
    expect(r.localPath).toBe('/tmp/projects/comGitlabAcme/team/api');
  });

  it('matches forge by host from URL', () => {
    const r = resolveSlug(parseSlug('https://gitlab.acme.com/team/api'), {
      config,
      configDir: '/cfg'
    });
    expect(r.forgeName).toBe('work');
    expect(r.localPath).toBe('/tmp/projects/comGitlabAcme/team/api');
  });

  it('errors on unknown forge name', () => {
    expect(() =>
      resolveSlug(parseSlug('nope:team/api'), { config, configDir: '/cfg' })
    ).toThrow(/not defined/);
  });

  it('errors on unknown host', () => {
    expect(() =>
      resolveSlug(parseSlug('https://example.com/foo/bar'), {
        config,
        configDir: '/cfg'
      })
    ).toThrow(/No forge configured/);
  });

  it('resolves a nested namespace on a gitlab forge', () => {
    const r = resolveSlug(parseSlug('work:group/sub/api'), {
      config,
      configDir: '/cfg'
    });
    expect(r.owner).toBe('group/sub');
    expect(r.repo).toBe('api');
    expect(r.localPath).toBe('/tmp/projects/comGitlabAcme/group/sub/api');
  });

  it('rejects a nested namespace on a forge that does not nest', () => {
    expect(() =>
      resolveSlug(parseSlug('foo/bar/baz'), { config, configDir: '/cfg' })
    ).toThrow(/github.*does not support nested namespaces/);
  });

  it('rejects a namespace deeper than the layout cap', () => {
    const deep = Array.from({ length: 12 }, (_, i) => `n${i}`).join('/');
    expect(() =>
      resolveSlug(parseSlug(`work:${deep}/api`), { config, configDir: '/cfg' })
    ).toThrow(/at most/);
  });

  it('resolves relative root against configDir', () => {
    const local: ForgeMapConfig = { ...config, root: './nested' };
    const r = resolveSlug(parseSlug('foo/bar'), {
      config: local,
      configDir: '/home/me/projects'
    });
    expect(r.localPath).toBe('/home/me/projects/nested/comGithub/foo/bar');
  });
});
