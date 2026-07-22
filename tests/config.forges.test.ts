import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOSTS,
  type EditableConfig,
  FORGE_TYPES,
  GIT_PROTOCOLS,
  addForge,
  buildForge,
  editForge,
  isForgeType,
  isGitProtocol,
  removeForge,
  setDefaultForge,
  validateForgeKey
} from '../src/config/forges.ts';

describe('validateForgeKey', () => {
  it('accepts a non-empty key', () => {
    expect(validateForgeKey('github')).toBeNull();
    expect(validateForgeKey('my-work_forge')).toBeNull();
  });

  it('rejects empty / whitespace-only keys', () => {
    expect(validateForgeKey('')).toMatch(/must not be empty/);
    expect(validateForgeKey('   ')).toMatch(/must not be empty/);
  });
});

describe('isForgeType / isGitProtocol', () => {
  it('narrows valid values', () => {
    for (const t of FORGE_TYPES) expect(isForgeType(t)).toBe(true);
    for (const p of GIT_PROTOCOLS) expect(isGitProtocol(p)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isForgeType('bitbucket')).toBe(false);
    expect(isGitProtocol('ftp')).toBe(false);
  });
});

describe('DEFAULT_HOSTS', () => {
  it('suggests hosts for the hosted forges and none for self-hosted', () => {
    expect(DEFAULT_HOSTS.github).toBe('github.com');
    expect(DEFAULT_HOSTS.codeberg).toBe('codeberg.org');
    expect(DEFAULT_HOSTS.gitea).toBeUndefined();
    expect(DEFAULT_HOSTS.git).toBeUndefined();
  });
});

describe('buildForge', () => {
  it('builds a non-git forge', () => {
    expect(
      buildForge({ type: 'github', host: 'github.com', dir: 'gh' })
    ).toEqual({ type: 'github', host: 'github.com', dir: 'gh' });
  });

  it('omits protocol for git unless it is https', () => {
    expect(buildForge({ type: 'git', host: 'h', dir: 'd' })).toEqual({
      type: 'git',
      host: 'h',
      dir: 'd'
    });
    expect(
      buildForge({ type: 'git', host: 'h', dir: 'd', protocol: 'ssh' })
    ).toEqual({ type: 'git', host: 'h', dir: 'd' });
    expect(
      buildForge({ type: 'git', host: 'h', dir: 'd', protocol: 'https' })
    ).toEqual({ type: 'git', host: 'h', dir: 'd', protocol: 'https' });
  });
});

describe('mutators', () => {
  const base = (): EditableConfig => ({
    root: '.',
    defaultForge: 'github',
    forges: {
      github: { type: 'github', host: 'github.com', dir: 'gh' }
    }
  });

  it('addForge inserts, creating the forges map when absent', () => {
    const config: EditableConfig = { root: '.' };
    addForge(config, 'work', { type: 'git', host: 'h', dir: 'd' });
    expect(config.forges).toEqual({
      work: { type: 'git', host: 'h', dir: 'd' }
    });
  });

  it('removeForge deletes a key and no-ops without a forges map', () => {
    const config = base();
    removeForge(config, 'github');
    expect(config.forges).toEqual({});
    expect(() => removeForge({}, 'x')).not.toThrow();
  });

  it('setDefaultForge reassigns the default', () => {
    const config = base();
    setDefaultForge(config, 'work');
    expect(config.defaultForge).toBe('work');
  });

  it('editForge patches provided fields only', () => {
    const config = base();
    editForge(config, 'github', { host: 'ghe.example.com', dir: 'x' });
    expect(config.forges!.github).toEqual({
      type: 'github',
      host: 'ghe.example.com',
      dir: 'x'
    });
  });

  it('editForge drops protocol when the resulting type is not git', () => {
    const config: EditableConfig = {
      forges: { c: { type: 'git', host: 'h', dir: 'd', protocol: 'https' } }
    };
    editForge(config, 'c', { type: 'github' });
    expect(config.forges!.c).toEqual({ type: 'github', host: 'h', dir: 'd' });
  });

  it('editForge sets and clears protocol on a git forge', () => {
    const config: EditableConfig = {
      forges: { c: { type: 'git', host: 'h', dir: 'd' } }
    };
    editForge(config, 'c', { protocol: 'https' });
    expect(config.forges!.c!.protocol).toBe('https');
    editForge(config, 'c', { protocol: null });
    expect(config.forges!.c!.protocol).toBeUndefined();
  });

  it('editForge no-ops for a missing key', () => {
    const config = base();
    editForge(config, 'nope', { host: 'x' });
    expect(config.forges!.github!.host).toBe('github.com');
  });
});
