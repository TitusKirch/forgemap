import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { expandTilde, resolveRoot } from '../src/utils/path.ts';

describe('expandTilde', () => {
  it('returns homedir for "~"', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  it('expands "~/foo" to <home>/foo', () => {
    expect(expandTilde('~/foo')).toBe(`${homedir()}/foo`);
  });

  it('leaves non-tilde paths untouched', () => {
    expect(expandTilde('/abs/path')).toBe('/abs/path');
    expect(expandTilde('./rel/path')).toBe('./rel/path');
    expect(expandTilde('plain')).toBe('plain');
  });
});

describe('resolveRoot', () => {
  it('returns absolute path as-is', () => {
    expect(resolveRoot('/tmp/projects', '/whatever')).toBe('/tmp/projects');
  });

  it('expands ~', () => {
    expect(resolveRoot('~/projects', '/whatever')).toBe(
      `${homedir()}/projects`
    );
  });

  it('resolves relative paths against configDir', () => {
    expect(resolveRoot('./nested', '/home/me')).toBe('/home/me/nested');
    expect(resolveRoot('nested', '/home/me')).toBe('/home/me/nested');
  });
});
