import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rootCommand } from '../src/cli.ts';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

describe('rootCommand meta', () => {
  // Guards TitusKirch/forgemap#68: citty answers `--version`/`-v` from
  // `meta.version` and the help header renders `(forgemap v<version>)` from it.
  // The value is injected from package.json at build time (vite `define`), so it
  // must match package.json rather than a hand-copied literal that would drift.
  it('carries the package version, injected at build time', () => {
    const meta = rootCommand.meta as { version?: string };

    expect(meta.version).toBe(pkg.version);
  });
});
