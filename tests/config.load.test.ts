import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadForgeMapConfig } from '../src/config/load.ts';

describe('loadForgeMapConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns defaults when no config file present', async () => {
    const loaded = await loadForgeMapConfig({ cwd: dir });
    expect(loaded.config.defaultForge).toBe('github');
    expect(loaded.config.forges.github).toBeDefined();
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
