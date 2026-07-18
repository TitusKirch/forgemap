import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './helpers/citty.ts';

const { loadForgeMapConfigMock } = vi.hoisted(() => ({
  loadForgeMapConfigMock: vi.fn()
}));

vi.mock('../src/config/load.ts', () => ({
  loadForgeMapConfig: loadForgeMapConfigMock
}));

import { __test, infoCommand } from '../src/commands/info.ts';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

function loadedWith(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      root: '/tmp/fake-root',
      defaultForge: 'github',
      forges: {
        github: { type: 'github', host: 'github.com', dir: 'comGithub' },
        work: { type: 'git', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
      }
    },
    configFile: '/tmp/fake/forgemap.config.ts',
    cwd: '/tmp/fake',
    source: 'walk-up',
    ...overrides
  };
}

describe('infoCommand', () => {
  beforeEach(() => {
    loadForgeMapConfigMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('reports version, node, config and forges as JSON', async () => {
    loadForgeMapConfigMock.mockResolvedValue(loadedWith());

    const { out, exit } = await runCli(infoCommand, ['--json']);
    expect(exit).toBeUndefined();
    const parsed = JSON.parse(out);

    // Version comes from the build-time injected __APP_VERSION__, not a literal.
    expect(parsed.version).toBe(pkg.version);
    expect(parsed.node).toBe(process.version);
    expect(parsed.config.source).toBe('walk-up');
    expect(parsed.config.file).toBe('/tmp/fake/forgemap.config.ts');
    expect(parsed.config.root).toBe('/tmp/fake-root');
    expect(parsed.config.error).toBeNull();
    expect(parsed.config.forges).toEqual([
      { name: 'github', type: 'github', dir: 'comGithub' },
      { name: 'work', type: 'git', dir: 'comGitlabAcme' }
    ]);
    // Binary + build sections are always present.
    expect(parsed.binary).toHaveProperty('invoked');
    expect(parsed.binary).toHaveProperty('resolved');
    expect(['linked', 'release', 'unknown']).toContain(parsed.build.kind);
  });

  it('renders a human-readable report by default', async () => {
    loadForgeMapConfigMock.mockResolvedValue(loadedWith());

    const { out, exit } = await runCli(infoCommand, []);
    expect(exit).toBeUndefined();
    expect(out).toContain('forgemap');
    expect(out).toContain(`v${pkg.version}`);
    expect(out).toContain(process.version);
    expect(out).toContain('config');
    expect(out).toContain('walk-up from cwd');
    expect(out).toContain('forges');
    expect(out).toContain('github');
    expect(out).toContain('work');
  });

  it('reports built-in defaults when no config file is found', async () => {
    loadForgeMapConfigMock.mockResolvedValue(
      loadedWith({
        configFile: undefined,
        source: 'default',
        config: {
          root: '/tmp/fake-root',
          defaultForge: 'github',
          forges: {
            github: { type: 'github', host: 'github.com', dir: 'comGithub' }
          }
        }
      })
    );

    const { out, exit } = await runCli(infoCommand, ['--json']);
    expect(exit).toBeUndefined();
    const parsed = JSON.parse(out);
    expect(parsed.config.source).toBe('default');
    expect(parsed.config.file).toBeNull();
    expect(parsed.version).toBe(pkg.version);
  });

  it('shows "none" for the config file in the pretty report when absent', async () => {
    loadForgeMapConfigMock.mockResolvedValue(
      loadedWith({ configFile: undefined, source: 'default' })
    );

    const { out } = await runCli(infoCommand, []);
    expect(out).toContain('built-in defaults (no config file found)');
    expect(out).toContain('none');
  });

  it('degrades the config section gracefully when the config is broken', async () => {
    loadForgeMapConfigMock.mockRejectedValue(new Error('ParseError: boom'));

    const { out, exit } = await runCli(infoCommand, ['--json']);
    // Never fails the command: version/node/binary must still be reported.
    expect(exit).toBeUndefined();
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(pkg.version);
    expect(parsed.node).toBe(process.version);
    expect(parsed.config.source).toBe('error');
    expect(parsed.config.error).toContain('boom');
    expect(parsed.config.forges).toEqual([]);
  });

  it('surfaces a broken config error in the pretty report', async () => {
    loadForgeMapConfigMock.mockRejectedValue(new Error('ParseError: boom'));

    const { out, exit } = await runCli(infoCommand, []);
    expect(exit).toBeUndefined();
    expect(out).toContain('failed to load');
    expect(out).toContain('boom');
  });
});

describe('info __test.resolveBinary', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-info-bin-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns nulls when there is no entry path', () => {
    expect(__test.resolveBinary(undefined)).toEqual({
      invoked: null,
      resolved: null
    });
  });

  it('resolves a symlink to its real target', async () => {
    const real = join(dir, 'forgemap.mjs');
    const link = join(dir, 'shim');
    await writeFile(real, '// bin', 'utf8');
    await symlink(real, link);

    const info = __test.resolveBinary(link);
    expect(info.invoked).toBe(link);
    expect(info.resolved).toBe(await realpath(real));
  });

  it('falls back to the invoked path when it cannot be resolved', () => {
    const missing = join(dir, 'does-not-exist');
    expect(__test.resolveBinary(missing)).toEqual({
      invoked: missing,
      resolved: missing
    });
  });
});

describe('info __test.findPackageRoot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-info-pkg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds the nearest package.json and reads its name', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'forgemap' }),
      'utf8'
    );
    const nested = join(dir, 'dist', 'bin');
    await mkdir(nested, { recursive: true });

    expect(__test.findPackageRoot(nested)).toEqual({ dir, name: 'forgemap' });
  });

  it('returns an undefined name for an unparseable package.json', async () => {
    await writeFile(join(dir, 'package.json'), '{ not json', 'utf8');
    const found = __test.findPackageRoot(dir);
    expect(found?.dir).toBe(dir);
    expect(found?.name).toBeUndefined();
  });

  it('returns null when no package.json exists up the tree', async () => {
    const nested = join(dir, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    expect(__test.findPackageRoot(nested)).toBeNull();
  });
});

describe('info __test.detectBuild', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-info-build-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function fakeTree(opts: {
    name?: string | null;
    git?: boolean;
  }): Promise<string> {
    if (opts.name !== null) {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: opts.name }),
        'utf8'
      );
    }
    if (opts.git) {
      await mkdir(join(dir, '.git'), { recursive: true });
    }
    const binDir = join(dir, 'dist', 'bin');
    await mkdir(binDir, { recursive: true });
    return join(binDir, 'forgemap.mjs');
  }

  it('is unknown when the binary path is null', () => {
    const build = __test.detectBuild(null);
    expect(build.kind).toBe('unknown');
    expect(build.packageRoot).toBeNull();
  });

  it('is linked when inside a forgemap git work tree', async () => {
    const bin = await fakeTree({ name: 'forgemap', git: true });
    const build = __test.detectBuild(bin);
    expect(build.kind).toBe('linked');
    expect(build.packageRoot).toBe(dir);
  });

  it('is release when a forgemap package has no git tree beside it', async () => {
    const bin = await fakeTree({ name: 'forgemap', git: false });
    const build = __test.detectBuild(bin);
    expect(build.kind).toBe('release');
    expect(build.packageRoot).toBe(dir);
  });

  it('is unknown when the nearest package is not forgemap', async () => {
    const bin = await fakeTree({ name: 'something-else', git: true });
    const build = __test.detectBuild(bin);
    expect(build.kind).toBe('unknown');
    expect(build.reason).toContain('not forgemap');
  });

  it('is unknown when no package.json is found above the binary', async () => {
    const bin = await fakeTree({ name: null });
    const build = __test.detectBuild(bin);
    expect(build.kind).toBe('unknown');
    // No forgemap package.json above a temp-dir binary: either nothing is found
    // or an unrelated ancestor package is, but never a linked/release verdict.
    expect(build.reason).toMatch(/no package\.json|not forgemap/);
  });
});
