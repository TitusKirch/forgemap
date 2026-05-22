import { describe, expect, it } from 'vitest';
import { parseSlug } from '../src/slug/parse.ts';

describe('parseSlug', () => {
  it('parses owner/repo', () => {
    expect(parseSlug('kirchDev/laravel-pbac')).toEqual({
      owner: 'kirchDev',
      repo: 'laravel-pbac'
    });
  });

  it('parses forge:owner/repo', () => {
    expect(parseSlug('work:team/api')).toEqual({
      forgeName: 'work',
      owner: 'team',
      repo: 'api'
    });
  });

  it('parses https URL', () => {
    expect(parseSlug('https://github.com/foo/bar')).toEqual({
      host: 'github.com',
      owner: 'foo',
      repo: 'bar'
    });
  });

  it('parses https URL with .git suffix', () => {
    expect(parseSlug('https://github.com/foo/bar.git')).toEqual({
      host: 'github.com',
      owner: 'foo',
      repo: 'bar'
    });
  });

  it('parses SSH form', () => {
    expect(parseSlug('git@github.com:foo/bar.git')).toEqual({
      host: 'github.com',
      owner: 'foo',
      repo: 'bar'
    });
  });

  it('parses SSH form without .git', () => {
    expect(parseSlug('git@gitlab.acme.com:team/api')).toEqual({
      host: 'gitlab.acme.com',
      owner: 'team',
      repo: 'api'
    });
  });

  it('rejects empty input', () => {
    expect(() => parseSlug('')).toThrow(/empty/);
  });

  it('rejects garbage', () => {
    expect(() => parseSlug('not a slug')).toThrow(/Unrecognized/);
  });
});
