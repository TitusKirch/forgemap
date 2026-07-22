import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import consola from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCommand } from '../src/commands/list.ts';
import { runCli } from './helpers/citty.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-list-'));
  await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  await mkdir(join(dir, 'comGithub', 'TitusKirch', 'forgemap'), {
    recursive: true
  });
  await mkdir(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'), {
    recursive: true
  });
  await mkdir(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'), {
    recursive: true
  });
  return dir;
}

async function runList(
  dir: string,
  query?: string,
  extra: Record<string, unknown> = {}
): Promise<string[]> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await listCommand.run!({
      args: {
        query,
        config: join(dir, 'forgemap.config.ts'),
        format: 'path',
        ...extra,
        _: query === undefined ? [] : [query]
      },
      rawArgs: query === undefined ? [] : [query],
      cmd: listCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return writes.join('').split('\n').filter(Boolean);
}

describe('listCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await setup();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists every cloned repo when no query is given', async () => {
    const lines = await runList(dir);
    expect(lines).toContain(join(dir, 'comGithub', 'TitusKirch', 'forgemap'));
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'));
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'));
  });

  it('lists every repo as slugs when no query is given', async () => {
    const lines = await runList(dir, undefined, { format: 'slug' });
    expect(lines.sort()).toEqual([
      'TitusKirch/forgemap',
      'kirchDev/forgemap-php',
      'kirchDev/laravel-pbac'
    ]);
  });

  it('respects --limit with no query', async () => {
    const lines = await runList(dir, undefined, { limit: '2' });
    expect(lines).toHaveLength(2);
  });

  it('--filter narrows the full listing when no query is given', async () => {
    const lines = await runList(dir, undefined, {
      filter: 'kirchDev',
      format: 'slug'
    });
    expect(lines.sort()).toEqual([
      'kirchDev/forgemap-php',
      'kirchDev/laravel-pbac'
    ]);
  });

  it('returns repos whose owner or repo matches fuzzily', async () => {
    const lines = await runList(dir, 'forgemap');
    expect(lines).toContain(join(dir, 'comGithub', 'TitusKirch', 'forgemap'));
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'));
    expect(lines).not.toContain(
      join(dir, 'comGithub', 'kirchDev', 'laravel-pbac')
    );
  });

  it('matches owner names', async () => {
    const lines = await runList(dir, 'kirchDev');
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'));
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'));
  });

  it('prints slug only with --format slug', async () => {
    const lines = await runList(dir, 'forgemap', { format: 'slug' });
    expect(lines).toContain('TitusKirch/forgemap');
    expect(lines).toContain('kirchDev/forgemap-php');
    expect(lines.every((l) => !l.startsWith('/'))).toBe(true);
  });

  it('renders a colored table with --format pretty', async () => {
    const lines = await runList(dir, 'forgemap', { format: 'pretty' });
    expect(lines.length).toBeGreaterThan(0);
    // Grouped forge → owner → repo: owners and repos render on separate lines.
    expect(lines.some((l) => l.includes('TitusKirch'))).toBe(true);
    expect(lines.some((l) => l.includes('kirchDev'))).toBe(true);
    expect(lines.some((l) => l.includes('forgemap-php'))).toBe(true);
  });

  it('respects --limit', async () => {
    const lines = await runList(dir, 'a', { limit: '1' });
    expect(lines).toHaveLength(1);
  });

  it('--filter narrows the searched set to a matching owner', async () => {
    const lines = await runList(dir, 'forgemap', { filter: 'kirchDev' });
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'));
    expect(lines).not.toContain(
      join(dir, 'comGithub', 'TitusKirch', 'forgemap')
    );
  });

  // An injected `filter: [...]` is a shape citty can never actually produce —
  // `parseArgs` keeps only the last occurrence of a repeated option. It still
  // pins `normalizeFilters`' array handling, which is how the command is
  // driven programmatically; the argv-level counterpart lives in the 'citty
  // argument parsing' block below.
  it('--filter is OR-combined when repeated', async () => {
    const lines = await runList(dir, 'forgemap', {
      filter: ['kirchDev', 'TitusKirch'],
      format: 'slug'
    });
    expect(lines).toContain('kirchDev/forgemap-php');
    expect(lines).toContain('TitusKirch/forgemap');
  });

  it('--filter applies before --limit', async () => {
    const lines = await runList(dir, 'forgemap', {
      filter: 'kirchDev',
      format: 'slug',
      limit: '5'
    });
    expect(lines).toEqual(['kirchDev/forgemap-php']);
  });

  it('prints nothing on no matches (exit 0)', async () => {
    const lines = await runList(dir, 'zzz-no-such-thing-zzz');
    expect(lines).toEqual([]);
  });

  // Issue #59: `--filter` is the one search flag whose parsing is non-trivial
  // (repeatable, and citty declares it without `multiple: true`), so it is
  // only meaningful when driven through real argv.
  describe('citty argument parsing', () => {
    async function runArgv(rawArgs: string[]): Promise<string[]> {
      const { lines } = await runCli(listCommand, [
        ...rawArgs,
        '--config',
        join(dir, 'forgemap.config.ts')
      ]);
      return lines;
    }

    it('OR-combines a repeated --filter', async () => {
      const lines = await runArgv([
        'forgemap',
        '--format',
        'slug',
        '--filter',
        'kirchDev',
        '--filter',
        'TitusKirch'
      ]);
      expect(lines.sort()).toEqual([
        'TitusKirch/forgemap',
        'kirchDev/forgemap-php'
      ]);
    });

    it('applies a single --filter', async () => {
      const lines = await runArgv([
        'forgemap',
        '--format',
        'slug',
        '--filter',
        'kirchDev'
      ]);
      expect(lines).toEqual(['kirchDev/forgemap-php']);
    });

    it('supports the --filter=value form', async () => {
      const lines = await runArgv([
        'forgemap',
        '--format',
        'slug',
        '--filter=kirchDev'
      ]);
      expect(lines).toEqual(['kirchDev/forgemap-php']);
    });
  });
  describe('output format resolution', () => {
    // Restore via the descriptor, not an assignment: outside a TTY the
    // property is absent, and assigning `undefined` back would leave it
    // defined-but-undefined instead of gone.
    let ttyDesc: PropertyDescriptor | undefined;

    beforeEach(() => {
      ttyDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    });

    afterEach(() => {
      if (ttyDesc) Object.defineProperty(process.stdout, 'isTTY', ttyDesc);
      else delete (process.stdout as unknown as Record<string, unknown>).isTTY;
    });

    it('groups several repos under one owner in the tree', async () => {
      const lines = await runList(dir, undefined, { format: 'pretty' });
      expect(lines.some((l) => l.includes('forgemap-php'))).toBe(true);
      expect(lines.some((l) => l.includes('laravel-pbac'))).toBe(true);
      // one owner line for the two kirchDev repos (the repo lines carry the
      // owner too, inside their localPath)
      const ownerLines = lines.filter(
        (l) => l.includes('kirchDev') && !l.includes('comGithub')
      );
      expect(ownerLines).toHaveLength(1);
    });

    it('rejects an unknown --format', async () => {
      const res = await runCli(listCommand, [
        '--format',
        'yaml',
        '--config',
        join(dir, 'forgemap.config.ts')
      ]);
      expect(res.exit).toBe(1);
    });

    it('auto picks pretty in a TTY', async () => {
      process.stdout.isTTY = true;
      const lines = await runList(dir, 'forgemap', { format: 'auto' });
      // the tree indents repos under their owner; a plain path listing does not
      expect(lines.some((l) => l.includes('TitusKirch'))).toBe(true);
      expect(lines.some((l) => l.trimStart() !== l)).toBe(true);
    });

    it('auto picks path when piped', async () => {
      process.stdout.isTTY = false;
      const lines = await runList(dir, 'forgemap', { format: 'auto' });
      expect(lines).toContain(join(dir, 'comGithub', 'TitusKirch', 'forgemap'));
    });

    it('reports no matches for a query in pretty format', async () => {
      const info: string[] = [];
      const spy = vi
        .spyOn(consola, 'info')
        .mockImplementation((...a: unknown[]) => info.push(String(a[0])));
      await runList(dir, 'zzz-no-such-thing-zzz', { format: 'pretty' });
      expect(info.join()).toContain('No matches for "zzz-no-such-thing-zzz"');
      spy.mockRestore();
    });

    it('reports an empty root in pretty format', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'forgemap-list-empty-'));
      await writeFile(
        join(empty, 'forgemap.config.ts'),
        FIXTURE_CONFIG,
        'utf8'
      );
      const info: string[] = [];
      const spy = vi
        .spyOn(consola, 'info')
        .mockImplementation((...a: unknown[]) => info.push(String(a[0])));
      await runList(empty, undefined, { format: 'pretty' });
      expect(info.join()).toContain('No repos found.');
      spy.mockRestore();
      await rm(empty, { recursive: true, force: true });
    });

    it('falls back to the cwd when no config file is discovered', async () => {
      const bare = await mkdtemp(join(tmpdir(), 'forgemap-list-bare-'));
      await mkdir(join(bare, 'comGithub', 'TitusKirch', 'forgemap'), {
        recursive: true
      });
      const saved = process.cwd();
      const savedXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = join(bare, 'xdg-empty');
      process.chdir(bare);
      try {
        // no --config and nothing to walk up to: the built-in defaults apply,
        // rooted at the cwd
        const res = await runCli(listCommand, ['--format', 'slug']);
        expect(res.lines).toContain('TitusKirch/forgemap');
      } finally {
        process.chdir(saved);
        if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = savedXdg;
        await rm(bare, { recursive: true, force: true });
      }
    });
  });
});
