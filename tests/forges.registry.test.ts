import { describe, expect, it } from 'vitest';
import { getForgeAdapter } from '../src/forges/registry.ts';

describe('getForgeAdapter', () => {
  it('returns the github adapter for type "github"', () => {
    const adapter = getForgeAdapter('github');
    expect(adapter).toBeDefined();
    expect(typeof adapter.clone).toBe('function');
  });

  it('throws "not implemented yet" for gitlab', () => {
    expect(() => getForgeAdapter('gitlab')).toThrow(/not implemented yet/);
  });

  it('throws "not implemented yet" for gitea', () => {
    expect(() => getForgeAdapter('gitea')).toThrow(/not implemented yet/);
  });

  it('throws "not implemented yet" for codeberg', () => {
    expect(() => getForgeAdapter('codeberg')).toThrow(/not implemented yet/);
  });
});
