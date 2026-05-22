import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configShowCommand } from '../src/commands/config/show.ts';

const FIXTURE_CONFIG = `export default {
  root: '~/repos',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'gh' }
  }
};
`;

describe('configShowCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-show-test-'));
    await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prints the loaded config and source path as JSON', async () => {
    const writes: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      await configShowCommand.run!({
        args: { config: join(dir, 'forgemap.config.ts'), _: [] },
        rawArgs: [],
        cmd: configShowCommand,
        data: undefined
      } as never);
    } finally {
      process.stdout.write = original;
    }
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.configFile).toBe(join(dir, 'forgemap.config.ts'));
    expect(parsed.config.defaultForge).toBe('github');
    expect(parsed.config.forges.github.dir).toBe('gh');
  });
});
