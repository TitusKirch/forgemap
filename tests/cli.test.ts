import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rootCommand } from '../src/cli.ts';
import { runCli } from './helpers/citty.ts';
import { seedRepo } from './helpers/layout.ts';

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

describe('the `ls` alias', () => {
  // TitusKirch/forgemap#95: `ls` is muscle memory for `list`, so citty's own
  // `meta.alias` carries it — the alias is resolved on dispatch and rendered
  // inside the existing help row (`list, ls`), never as a second command.
  it('dispatches `forgemap ls` to the list command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forgemap-alias-'));
    try {
      await writeFile(
        join(dir, 'forgemap.config.ts'),
        `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`,
        'utf8'
      );
      await seedRepo(dir, 'comGithub', 'TitusKirch', 'forgemap');

      const { lines } = await runCli(rootCommand, [
        'ls',
        '--config',
        join(dir, 'forgemap.config.ts'),
        '--format',
        'slug'
      ]);

      expect(lines).toContain('TitusKirch/forgemap');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps `list` the canonical name in the help row', () => {
    const list = rootCommand.subCommands as Record<
      string,
      { meta?: { name?: string; alias?: string | string[] } }
    >;

    expect(list.list?.meta?.name).toBe('list');
    expect(list.list?.meta?.alias).toBe('ls');
    expect(Object.keys(list)).not.toContain('ls');
  });
});
