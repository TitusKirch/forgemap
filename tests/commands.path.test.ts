import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathCommand } from '../src/commands/path.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
  }
};
`;

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-path-test-'));
  await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  return dir;
}

async function runPath(dir: string, slug: string): Promise<string> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await pathCommand.run!({
      args: {
        slug,
        config: join(dir, 'forgemap.config.ts'),
        _: [slug]
      },
      rawArgs: [slug],
      cmd: pathCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return writes.join('').trimEnd();
}

describe('pathCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await setup();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prints the resolved local path for a short slug', async () => {
    const out = await runPath(dir, 'kirchDev/laravel-pbac');
    expect(out).toBe(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'));
  });

  it('prints the resolved path for a named forge', async () => {
    const out = await runPath(dir, 'work:team/api');
    expect(out).toBe(join(dir, 'comGitlabAcme', 'team', 'api'));
  });

  it('prints the resolved path for a full URL', async () => {
    const out = await runPath(dir, 'https://github.com/foo/bar.git');
    expect(out).toBe(join(dir, 'comGithub', 'foo', 'bar'));
  });
});
