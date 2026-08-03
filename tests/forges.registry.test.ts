import { describe, expect, it } from 'vitest';
import { getForgeAdapter } from '../src/forges/registry.ts';

describe('getForgeAdapter', () => {
  it('returns the github adapter for type "github"', () => {
    const adapter = getForgeAdapter('github');
    expect(adapter).toBeDefined();
    expect(typeof adapter.clone).toBe('function');
  });

  it('returns the gitlab adapter for type "gitlab"', () => {
    const adapter = getForgeAdapter('gitlab');
    expect(adapter).toBeDefined();
    expect(typeof adapter.clone).toBe('function');
    expect(typeof adapter.checkRemotes).toBe('function');
  });

  it('returns the git adapter for type "git"', () => {
    expect(typeof getForgeAdapter('git').clone).toBe('function');
  });

  it('throws "not implemented yet" for gitea', () => {
    expect(() => getForgeAdapter('gitea')).toThrow(/not implemented yet/);
  });

  it('throws "not implemented yet" for codeberg', () => {
    expect(() => getForgeAdapter('codeberg')).toThrow(/not implemented yet/);
  });
});
