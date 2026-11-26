import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isOutdated,
  parseVersion
} from '../src/install/version.ts';

function cmp(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`unparsable: ${a} / ${b}`);
  return compareVersions(left, right);
}

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: []
    });
  });

  it('accepts a leading v and surrounding whitespace', () => {
    expect(parseVersion(' v10.0.4 ')).toMatchObject({
      major: 10,
      minor: 0,
      patch: 4
    });
  });

  it('splits the prerelease into identifiers and drops build metadata', () => {
    expect(parseVersion('1.0.0-rc.2+build.9')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      pre: ['rc', '2']
    });
  });

  it.each(['', '1', '1.2', '1.2.3.4', 'next', '1.2.x', '-1.0.0'])(
    'rejects %j',
    (input) => {
      expect(parseVersion(input)).toBeNull();
    }
  );
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(cmp('1.0.0', '2.0.0')).toBe(-1);
    expect(cmp('1.10.0', '1.9.0')).toBe(1);
    expect(cmp('1.2.3', '1.2.4')).toBe(-1);
    expect(cmp('1.2.3', '1.2.3')).toBe(0);
  });

  it('ranks a release above any prerelease of the same version', () => {
    expect(cmp('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(cmp('1.0.0', '1.0.0-rc.1')).toBe(1);
  });

  it('compares prerelease identifiers by semver precedence', () => {
    expect(cmp('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1);
    expect(cmp('1.0.0-rc.9', '1.0.0-rc.10')).toBe(-1);
    expect(cmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(cmp('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    expect(cmp('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(cmp('1.0.0-alpha', '1.0.0-1')).toBe(1);
    expect(cmp('1.0.0-rc.1', '1.0.0-rc.1')).toBe(0);
  });
});

describe('isOutdated', () => {
  it('is true only when current precedes latest', () => {
    expect(isOutdated('0.9.0', '1.0.0')).toBe(true);
    expect(isOutdated('1.0.0', '1.0.0')).toBe(false);
    expect(isOutdated('1.1.0', '1.0.0')).toBe(false);
    expect(isOutdated('1.0.0-rc.1', '1.0.0')).toBe(true);
  });

  it('never claims an update when either version is unparsable', () => {
    expect(isOutdated('0.9.0', 'garbage')).toBe(false);
    expect(isOutdated('garbage', '1.0.0')).toBe(false);
  });
});
