import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadForgeMapConfig } from '../src/config/load.ts';

const SIMPLE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: { github: { type: 'github', host: 'github.com', dir: 'gh' } }
};
`;

describe('loadForgeMapConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.FORGEMAP_CONFIG;
  });

  it('returns defaults when no config file present', async () => {
    const loaded = await loadForgeMapConfig({ cwd: dir });
    expect(loaded.config.defaultForge).toBe('github');
    expect(loaded.config.forges.github).toBeDefined();
    // No file discovered → source `default` and no config file path.
    expect(loaded.source).toBe('default');
    expect(loaded.configFile).toBeUndefined();
  });

  it('reports source "walk-up" for a discovered config', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), SIMPLE_CONFIG, 'utf8');
    const loaded = await loadForgeMapConfig({ cwd: dir });
    expect(loaded.source).toBe('walk-up');
  });

  it('reports source "flag" when a config file is passed explicitly', async () => {
    const file = join(dir, 'custom.config.ts');
    await writeFile(file, SIMPLE_CONFIG, 'utf8');
    const loaded = await loadForgeMapConfig({ cwd: dir, configFile: file });
    expect(loaded.source).toBe('flag');
    expect(loaded.configFile).toBe(file);
  });

  it('reports source "env" from FORGEMAP_CONFIG', async () => {
    const file = join(dir, 'env.config.ts');
    await writeFile(file, SIMPLE_CONFIG, 'utf8');
    process.env.FORGEMAP_CONFIG = file;
    const loaded = await loadForgeMapConfig({ cwd: dir });
    expect(loaded.source).toBe('env');
    expect(loaded.configFile).toBe(file);
  });

  it('reports source "global" from the XDG fallback', async () => {
    const home = await mkdtemp(join(tmpdir(), 'forgemap-xdg-'));
    const cfgDir = join(home, 'forgemap');
    await mkdir(cfgDir, { recursive: true });
    await writeFile(join(cfgDir, 'forgemap.config.ts'), SIMPLE_CONFIG, 'utf8');
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
    try {
      // cwd is an empty dir so walk-up finds nothing and the global wins.
      const empty = await mkdtemp(join(tmpdir(), 'forgemap-empty-'));
      const loaded = await loadForgeMapConfig({ cwd: empty });
      expect(loaded.source).toBe('global');
      await rm(empty, { recursive: true, force: true });
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      await rm(home, { recursive: true, force: true });
    }
  });

  it('loads a forgemap.config.ts via walk-up', async () => {
    const configContent = `export default {
      root: '~/projects',
      defaultForge: 'github',
      forges: {
        github: { type: 'github', host: 'github.com', dir: 'gh' },
        work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'work' }
      }
    };
    `;
    await writeFile(join(dir, 'forgemap.config.ts'), configContent, 'utf8');
    const loaded = await loadForgeMapConfig({ cwd: dir });
    expect(loaded.configFile).toBeDefined();
    expect(loaded.config.forges.work).toBeDefined();
    expect(loaded.config.forges.github?.dir).toBe('gh');
  });

  it('finds the config from a nested subdirectory (walk-up)', async () => {
    const cfg = `export default {
      root: '.',
      defaultForge: 'github',
      forges: { github: { type: 'github', host: 'github.com', dir: 'gh' } }
    };
    `;
    await writeFile(join(dir, 'forgemap.config.ts'), cfg, 'utf8');
    const nested = join(dir, 'gh', 'owner', 'repo');
    await mkdir(nested, { recursive: true });

    const loaded = await loadForgeMapConfig({ cwd: nested });
    expect(loaded.configFile).toBe(join(dir, 'forgemap.config.ts'));
    // configDir resolves to where the file lives, not the nested cwd.
    expect(loaded.cwd).toBe(dir);
  });
});
