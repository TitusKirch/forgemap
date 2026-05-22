import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configInitCommand } from '../src/commands/config/init.ts';

async function runInit(args: { out?: string; force?: boolean }): Promise<void> {
  await configInitCommand.run!({
    args: {
      out: args.out ?? '.',
      force: args.force ?? false,
      _: []
    },
    rawArgs: [],
    cmd: configInitCommand,
    data: undefined
  } as never);
}

describe('configInitCommand', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-init-test-'));
    originalCwd = process.cwd();
    process.chdir(dir);
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('writes a forgemap.config.ts with sensible defaults', async () => {
    await runInit({});
    const written = await readFile(join(dir, 'forgemap.config.ts'), 'utf8');
    expect(written).toContain("defaultForge: 'github'");
    expect(written).toContain("dir: 'comGithub'");
  });

  it('refuses to overwrite an existing file without --force', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), 'existing', 'utf8');
    await runInit({});
    expect(process.exitCode).toBe(1);
    const after = await readFile(join(dir, 'forgemap.config.ts'), 'utf8');
    expect(after).toBe('existing');
  });

  it('overwrites with --force', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), 'existing', 'utf8');
    await runInit({ force: true });
    const after = await readFile(join(dir, 'forgemap.config.ts'), 'utf8');
    expect(after).toContain('defaultForge');
  });
});
