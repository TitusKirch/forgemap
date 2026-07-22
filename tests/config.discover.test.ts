import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'pathe';
import { discoverConfigFiles } from '../src/config/load.ts';

describe('discoverConfigFiles', () => {
  let root: string;
  let savedXdg: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'forgemap-discover-'));
    savedXdg = process.env.XDG_CONFIG_HOME;
    // Point the global-config lookup at an empty dir so an unrelated real
    // ~/.config/forgemap can't leak into these assertions.
    process.env.XDG_CONFIG_HOME = join(root, 'xdg-empty');
  });

  afterEach(async () => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    await rm(root, { recursive: true, force: true });
  });

  it('collects one config per directory, walking up nearest-first', async () => {
    const near = join(root, 'a', 'b');
    await mkdir(near, { recursive: true });
    await writeFile(join(root, 'a', 'forgemap.config.ts'), 'export default {}');
    await writeFile(join(root, 'forgemap.config.mjs'), 'export default {}');

    const found = discoverConfigFiles(near);
    const paths = found.map((c) => c.path);

    const nearIdx = paths.indexOf(join(root, 'a', 'forgemap.config.ts'));
    const farIdx = paths.indexOf(join(root, 'forgemap.config.mjs'));
    expect(nearIdx).toBeGreaterThanOrEqual(0);
    expect(farIdx).toBeGreaterThan(nearIdx);
    expect(found.every((c) => c.source === 'walk-up')).toBe(true);
  });

  it('takes only the first basename in a directory', async () => {
    await writeFile(join(root, 'forgemap.config.ts'), 'export default {}');
    await writeFile(join(root, 'forgemap.config.json'), '{}');

    const found = discoverConfigFiles(root);
    const inRoot = found.filter((c) =>
      c.path.startsWith(join(root, 'forgemap'))
    );
    expect(inRoot).toHaveLength(1);
    expect(inRoot[0]!.path).toBe(join(root, 'forgemap.config.ts'));
  });

  it('appends the global config when present', async () => {
    const globalDir = join(root, 'xdg', 'forgemap');
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'forgemap.config.json'), '{}');
    process.env.XDG_CONFIG_HOME = join(root, 'xdg');

    const start = join(root, 'nowhere');
    await mkdir(start, { recursive: true });
    const found = discoverConfigFiles(start);

    const global = found.find((c) => c.source === 'global');
    expect(global?.path).toBe(join(globalDir, 'forgemap.config.json'));
  });
});
