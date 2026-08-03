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

  it('parses a nested namespace in the short form', () => {
    expect(parseSlug('group/sub/api')).toEqual({
      owner: 'group/sub',
      repo: 'api'
    });
  });

  it('parses a nested namespace in the named form', () => {
    expect(parseSlug('work:group/sub/deeper/api')).toEqual({
      forgeName: 'work',
      owner: 'group/sub/deeper',
      repo: 'api'
    });
  });

  it('parses a nested namespace in a URL', () => {
    expect(parseSlug('https://gitlab.com/group/sub/repo')).toEqual({
      host: 'gitlab.com',
      owner: 'group/sub',
      repo: 'repo'
    });
  });

  it('parses a nested namespace over SSH', () => {
    expect(parseSlug('git@gitlab.com:group/sub/repo.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group/sub',
      repo: 'repo'
    });
  });

  it('truncates a URL at GitLab’s /-/ separator', () => {
    expect(
      parseSlug('https://gitlab.com/group/sub/repo/-/merge_requests/1')
    ).toEqual({
      host: 'gitlab.com',
      owner: 'group/sub',
      repo: 'repo'
    });
  });

  it('rejects a URL whose path is only the /-/ separator', () => {
    expect(() => parseSlug('https://gitlab.com/group/-/foo')).toThrow(
      /must contain a namespace and repo/
    );
  });

  it('rejects empty input', () => {
    expect(() => parseSlug('')).toThrow(/empty/);
  });

  it('rejects garbage', () => {
    expect(() => parseSlug('not a slug')).toThrow(/Unrecognized/);
  });

  it('rejects URLs without a namespace/repo path', () => {
    expect(() => parseSlug('https://github.com/foo')).toThrow(
      /must contain a namespace and repo/
    );
  });

  it('rejects malformed http URLs', () => {
    expect(() => parseSlug('https://')).toThrow(/Invalid URL|must contain/);
  });
});
