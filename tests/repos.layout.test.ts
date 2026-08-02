import { describe, expect, it } from 'vitest';
import type { ForgeType } from '../src/config/schema.ts';
import {
  checkNamespaceDepth,
  MAX_NAMESPACE_DEPTH,
  MAX_SCAN_DEPTH,
  namespaceDepthLimit
} from '../src/repos/layout.ts';

describe('namespaceDepthLimit', () => {
  it.each<[ForgeType, number]>([
    ['github', 1],
    ['gitea', 1],
    ['codeberg', 1],
    ['gitlab', MAX_NAMESPACE_DEPTH],
    ['git', MAX_NAMESPACE_DEPTH]
  ])('allows %s namespaces up to %i segments', (type, expected) => {
    expect(namespaceDepthLimit(type)).toBe(expected);
  });

  // Arithmetic between two constants, and nothing more: that a repo at the
  // cap is actually *reachable* is a property of the walk, guarded by the
  // boundary cases in `repos.scan.test.ts`.
  it('leaves the repo segment room inside the scan cap', () => {
    expect(MAX_NAMESPACE_DEPTH).toBe(MAX_SCAN_DEPTH - 1);
  });
});

describe('checkNamespaceDepth', () => {
  it('accepts a single segment on a flat forge', () => {
    expect(checkNamespaceDepth('gh', 'github', 'kirchDev')).toBeNull();
  });

  it('accepts a nested namespace on gitlab', () => {
    expect(checkNamespaceDepth('work', 'gitlab', 'group/sub')).toBeNull();
  });

  it('names the forge and its type when a flat forge is given nesting', () => {
    expect(checkNamespaceDepth('gh', 'github', 'group/sub')).toMatch(
      /Forge "gh" \(type github\) does not support nested namespaces/
    );
  });

  it('rejects a gitea namespace that nests', () => {
    expect(checkNamespaceDepth('cb', 'codeberg', 'a/b')).toContain(
      'does not support nested namespaces'
    );
  });

  it('reports the cap when a nesting forge is given too much', () => {
    const deep = Array.from(
      { length: MAX_NAMESPACE_DEPTH + 1 },
      (_, i) => `n${i}`
    ).join('/');
    expect(checkNamespaceDepth('work', 'gitlab', deep)).toBe(
      `Namespace "${deep}" is ${MAX_NAMESPACE_DEPTH + 1} segments deep; forgemap supports at most ${MAX_NAMESPACE_DEPTH}.`
    );
  });

  it('accepts exactly the cap', () => {
    const atCap = Array.from(
      { length: MAX_NAMESPACE_DEPTH },
      (_, i) => `n${i}`
    ).join('/');
    expect(checkNamespaceDepth('work', 'git', atCap)).toBeNull();
  });
});
