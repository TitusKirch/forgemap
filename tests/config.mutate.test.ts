import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'pathe';
import { addForge, editForge, removeForge } from '../src/config/forges.ts';
import { mutateConfigFile } from '../src/config/mutate.ts';

const TS_SOURCE = `import { defineForgeMapConfig } from 'forgemap/config';

export default defineForgeMapConfig({
  root: '~/dev',
  defaultForge: 'github',
  forges: {
    github: {
      type: 'github',
      host: 'github.com',
      dir: 'comGithub'
    }
  }
});
`;

describe('mutateConfigFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-mutate-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a .ts config, unwrapping defineForgeMapConfig', async () => {
    const path = join(dir, 'forgemap.config.ts');
    await writeFile(path, TS_SOURCE);

    await mutateConfigFile(path, (c) =>
      addForge(c, 'work', { type: 'git', host: 'git.example.com', dir: 'work' })
    );
    let written = await readFile(path, 'utf8');
    expect(written).toContain('defineForgeMapConfig(');
    expect(written).toContain('work: {');
    expect(written).toContain("host: 'git.example.com'");

    await mutateConfigFile(path, (c) => editForge(c, 'github', { dir: 'gh' }));
    written = await readFile(path, 'utf8');
    expect(written).toContain("dir: 'gh'");

    await mutateConfigFile(path, (c) => removeForge(c, 'work'));
    written = await readFile(path, 'utf8');
    expect(written).not.toContain('git.example.com');
  });

  it('edits a .json config in place', async () => {
    const path = join(dir, 'forgemap.config.json');
    await writeFile(
      path,
      JSON.stringify({
        root: '.',
        defaultForge: 'github',
        forges: { github: { type: 'github', host: 'github.com', dir: 'gh' } }
      })
    );

    await mutateConfigFile(path, (c) =>
      addForge(c, 'work', { type: 'git', host: 'h', dir: 'd' })
    );

    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed.forges.work).toEqual({ type: 'git', host: 'h', dir: 'd' });
  });

  it('rejects a config with no usable default export', async () => {
    const path = join(dir, 'forgemap.config.ts');
    await writeFile(path, 'export const notDefault = 1;\n');
    await expect(mutateConfigFile(path, () => {})).rejects.toThrow();
  });
});
