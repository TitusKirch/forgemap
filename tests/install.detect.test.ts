import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyInstall,
  formatCommand,
  type InstallInfo,
  type InstallKind,
  updateBlocker
} from '../src/install/detect.ts';

let root: string;

/**
 * Lay out a `forgemap` package at `relative` with a binary under it, the way an
 * installer would, and classify it. The path *shape* is the whole input to the
 * classifier, so the fixtures mirror each manager's real layout verbatim.
 */
async function classifyAt(
  relative: string,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    name?: string;
    git?: boolean;
    writable?: boolean;
  } = {}
): Promise<InstallInfo> {
  const packageRoot = join(root, relative);
  await mkdir(join(packageRoot, 'dist', 'bin'), { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: options.name ?? 'forgemap' })
  );
  if (options.git) await mkdir(join(packageRoot, '.git'));
  const binary = join(packageRoot, 'dist', 'bin', 'forgemap.mjs');
  await writeFile(binary, '');

  return classifyInstall(
    { invoked: binary, resolved: binary },
    {
      env: options.env ?? {},
      platform: options.platform ?? 'linux',
      isWritable: () => options.writable ?? true
    }
  );
}

function installOf(overrides: Partial<InstallInfo> = {}): InstallInfo {
  return {
    kind: 'pnpm-global',
    packageRoot: '/home/u/.local/share/pnpm/global/5/.pnpm/forgemap/x',
    reason: "pnpm's global store",
    command: { bin: 'pnpm', args: ['add', '-g', 'forgemap@latest'] },
    writable: true,
    ...overrides
  };
}

describe('classifyInstall', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'forgemap-detect-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('recognises npm’s global prefix', async () => {
    const install = await classifyAt('usr/lib/node_modules/forgemap');
    expect(install.kind).toBe('npm-global');
    expect(install.command).toEqual({
      bin: 'npm',
      args: ['install', '-g', 'forgemap@latest']
    });
    expect(updateBlocker(install)).toBeNull();
  });

  it('recognises npm’s Windows global prefix only on win32', async () => {
    const layout = 'AppData/Roaming/npm/node_modules/forgemap';
    await expect(
      classifyAt(layout, { platform: 'win32' }).then((i) => i.kind)
    ).resolves.toBe('npm-global');
    // Off Windows the same shape is just a nested node_modules.
    await expect(
      classifyAt(`other/${layout}`, { platform: 'linux' }).then((i) => i.kind)
    ).resolves.toBe('project');
  });

  it('recognises pnpm’s global store by its numbered generation', async () => {
    const install = await classifyAt(
      'share/pnpm/global/5/.pnpm/forgemap@1.0.0/node_modules/forgemap'
    );
    expect(install.kind).toBe('pnpm-global');
    expect(formatCommand(install.command!)).toBe('pnpm add -g forgemap@latest');
  });

  it('treats a project’s own pnpm store as a project dependency', async () => {
    const install = await classifyAt(
      'work/app/node_modules/.pnpm/forgemap@1.0.0/node_modules/forgemap'
    );
    expect(install.kind).toBe('project');
    expect(install.command).toBeNull();
  });

  it('recognises bun’s global install directory', async () => {
    const install = await classifyAt(
      '.bun/install/global/node_modules/forgemap'
    );
    expect(install.kind).toBe('bun-global');
    expect(formatCommand(install.command!)).toBe('bun add -g forgemap@latest');
  });

  it('recognises yarn’s global node_modules', async () => {
    const install = await classifyAt(
      '.config/yarn/global/node_modules/forgemap'
    );
    expect(install.kind).toBe('yarn-global');
    expect(formatCommand(install.command!)).toBe(
      'yarn global add forgemap@latest'
    );
  });

  it('recognises a volta image before its inner lib/node_modules', async () => {
    const install = await classifyAt(
      '.volta/tools/image/packages/forgemap/lib/node_modules/forgemap'
    );
    expect(install.kind).toBe('volta');
    expect(formatCommand(install.command!)).toBe(
      'volta install forgemap@latest'
    );
  });

  it.each([
    ['PNPM_HOME', 'pnpm-home', 'pnpm-global'],
    ['BUN_INSTALL', 'bun-home', 'bun-global'],
    ['VOLTA_HOME', 'volta-home', 'volta'],
    ['npm_config_prefix', 'npm-prefix', 'npm-global']
  ])(
    'classifies by %s when the layout is unfamiliar',
    async (key, home, expected) => {
      const install = await classifyAt(`${home}/somewhere/forgemap`, {
        env: { [key]: join(root, home) }
      });
      expect(install.kind).toBe(expected as InstallKind);
    }
  );

  it.each([
    ['.npm/_npx/abc123/node_modules/forgemap', 'an npx cache'],
    ['.cache/pnpm/dlx/abc123/node_modules/forgemap', 'a pnpm dlx cache'],
    ['.bun/install/cache/forgemap@1.0.0/node_modules/forgemap', 'a bun cache']
  ])('refuses to update %s (%s)', async (layout) => {
    const install = await classifyAt(layout, {
      env: { BUN_INSTALL: join(root, '.bun') }
    });
    expect(install.kind).toBe('ephemeral');
    expect(install.command).toBeNull();
    expect(updateBlocker(install)).toContain('npx/dlx cache');
  });

  // The paths below are the real pnpm 11 layout, measured from a
  // `pnpm add -g forgemap@latest` into a throwaway PNPM_HOME: `argv[1]` points
  // into the global generation directory, while the resolved binary lands in
  // the content-addressable store that pnpm 11 shares with every project.
  describe('pnpm 11, where the store says nothing about the install', () => {
    /** `$PNPM_HOME`, with both the generation dir and the store inside it. */
    const HOME = 'share/pnpm';
    const GLOBAL = `${HOME}/global/v11/9bb288faafa6fc953fe2fc/node_modules/forgemap`;
    const STORE = `${HOME}/store/v11/links/@/forgemap/0.11.0/62836aed91/node_modules/forgemap`;

    /** Lay the package out at `STORE` but report `argv[1]` from `GLOBAL`. */
    async function classifyPnpm(
      env: NodeJS.ProcessEnv,
      invokedFrom: string | null = GLOBAL
    ): Promise<InstallInfo> {
      const packageRoot = join(root, STORE);
      await mkdir(join(packageRoot, 'dist', 'bin'), { recursive: true });
      await writeFile(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'forgemap' })
      );
      const resolved = join(packageRoot, 'dist', 'bin', 'forgemap.mjs');
      await writeFile(resolved, '');
      return classifyInstall(
        {
          invoked: invokedFrom
            ? join(root, invokedFrom, 'dist', 'bin', 'forgemap.mjs')
            : null,
          resolved
        },
        { env, platform: 'linux', isWritable: () => true }
      );
    }

    it('places it by $PNPM_HOME on the invoked path', async () => {
      const install = await classifyPnpm({ PNPM_HOME: join(root, HOME) });
      expect(install.kind).toBe('pnpm-global');
      expect(formatCommand(install.command!)).toBe(
        'pnpm add -g forgemap@latest'
      );
    });

    it('places it by the global generation directory without $PNPM_HOME', async () => {
      const install = await classifyPnpm({});
      expect(install.kind).toBe('pnpm-global');
    });

    it('refuses to guess from the shared store alone', async () => {
      // No shim path, no $PNPM_HOME: this store path is equally consistent with
      // a project dependency, so naming either one would be a coin flip.
      const install = await classifyPnpm({}, null);
      expect(install.kind).toBe('unknown');
      expect(install.command).toBeNull();
      expect(updateBlocker(install)).toContain('not recognised');
    });

    it('never claims a run launched from a project as a global install', async () => {
      // The store sits under $PNPM_HOME, as it does by default, but this run
      // was launched from a project — so the home must not decide it. The
      // package root is still the shared store, which cannot tell the two
      // apart, so the honest answer is `unknown` rather than either kind.
      const install = await classifyPnpm(
        { PNPM_HOME: join(root, HOME) },
        'work/app/node_modules/forgemap'
      );
      expect(install.kind).toBe('unknown');
      expect(install.command).toBeNull();
    });
  });

  it('reports a git work tree as a linked dev build', async () => {
    const install = await classifyAt('src/forgemap', { git: true });
    expect(install.kind).toBe('linked');
    expect(install.command).toBeNull();
    expect(install.writable).toBe(false);
    expect(updateBlocker(install)).toContain('linked dev build');
  });

  it('reports an unrecognised layout rather than guessing an installer', async () => {
    const install = await classifyAt('opt/forgemap');
    expect(install.kind).toBe('unknown');
    expect(install.command).toBeNull();
    expect(updateBlocker(install)).toContain('not recognised');
  });

  it('reports a foreign package root as unknown', async () => {
    const install = await classifyAt('usr/lib/node_modules/forgemap', {
      name: 'something-else'
    });
    expect(install.kind).toBe('unknown');
    expect(install.reason).toContain('not forgemap');
  });

  it('reports an unresolvable binary as unknown', () => {
    const install = classifyInstall({ invoked: null, resolved: null });
    expect(install.kind).toBe('unknown');
    expect(install.reason).toBe('binary path could not be resolved');
  });

  it('probes the node_modules above the package, not the package itself', async () => {
    const seen: string[] = [];
    const packageRoot = join(root, 'usr/lib/node_modules/forgemap');
    await mkdir(join(packageRoot, 'dist', 'bin'), { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'forgemap' })
    );
    const binary = join(packageRoot, 'dist', 'bin', 'forgemap.mjs');
    await writeFile(binary, '');

    classifyInstall(
      { invoked: binary, resolved: binary },
      {
        env: {},
        platform: 'linux',
        isWritable: (dir) => {
          seen.push(dir);
          return true;
        }
      }
    );
    expect(seen).toEqual([join(root, 'usr/lib/node_modules')]);
  });
});

describe('updateBlocker', () => {
  it('passes a writable global install', () => {
    expect(updateBlocker(installOf())).toBeNull();
  });

  it('blocks an unwritable target and never proposes sudo', () => {
    const blocker = updateBlocker(installOf({ writable: false }));
    expect(blocker).toContain('not writable');
    expect(blocker).not.toContain('sudo');
  });

  it('points a project dependency at its own package.json', () => {
    expect(
      updateBlocker(installOf({ kind: 'project', command: null }))
    ).toContain('package.json');
  });

  it('blocks a known kind that carries no command', () => {
    expect(
      updateBlocker(installOf({ kind: 'npm-global', command: null }))
    ).toBe('no update command is known for this install');
  });
});

describe('formatCommand', () => {
  it('renders the line a user would type', () => {
    expect(
      formatCommand({ bin: 'npm', args: ['install', '-g', 'x@latest'] })
    ).toBe('npm install -g x@latest');
  });
});
