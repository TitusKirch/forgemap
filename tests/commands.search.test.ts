import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchCommand } from '../src/commands/search.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-search-'));
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

async function runSearch(
  dir: string,
  query: string,
  extra: Record<string, unknown> = {}
): Promise<string[]> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await searchCommand.run!({
      args: {
        query,
        config: join(dir, 'forgemap.config.ts'),
        format: 'path',
        ...extra,
        _: [query]
      },
      rawArgs: [query],
      cmd: searchCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return writes.join('').split('\n').filter(Boolean);
}

describe('searchCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await setup();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns repos whose owner or repo matches fuzzily', async () => {
    const lines = await runSearch(dir, 'forgemap');
    expect(lines).toContain(join(dir, 'comGithub', 'TitusKirch', 'forgemap'));
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'));
    expect(lines).not.toContain(
      join(dir, 'comGithub', 'kirchDev', 'laravel-pbac')
    );
  });

  it('matches owner names', async () => {
    const lines = await runSearch(dir, 'kirchDev');
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'forgemap-php'));
    expect(lines).toContain(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'));
  });

  it('prints slug only with --format slug', async () => {
    const lines = await runSearch(dir, 'forgemap', { format: 'slug' });
    expect(lines).toContain('TitusKirch/forgemap');
    expect(lines).toContain('kirchDev/forgemap-php');
    expect(lines.every((l) => !l.startsWith('/'))).toBe(true);
  });

  it('renders a colored table with --format pretty', async () => {
    const lines = await runSearch(dir, 'forgemap', { format: 'pretty' });
    expect(lines.length).toBeGreaterThan(0);
    // Grouped forge → owner → repo: owners and repos render on separate lines.
    expect(lines.some((l) => l.includes('TitusKirch'))).toBe(true);
    expect(lines.some((l) => l.includes('kirchDev'))).toBe(true);
    expect(lines.some((l) => l.includes('forgemap-php'))).toBe(true);
  });

  it('respects --limit', async () => {
    const lines = await runSearch(dir, 'a', { limit: '1' });
    expect(lines).toHaveLength(1);
  });

  it('prints nothing on no matches (exit 0)', async () => {
    const lines = await runSearch(dir, 'zzz-no-such-thing-zzz');
    expect(lines).toEqual([]);
  });
});
