import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import consola from 'consola';
import { pickCommand } from '../src/commands/pick.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

async function runPick(
  dir: string,
  args: { query?: string } = {}
): Promise<{ out: string; exit: number | undefined }> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    await pickCommand.run!({
      args: {
        query: args.query,
        config: join(dir, 'forgemap.config.ts'),
        _: args.query ? [args.query] : []
      },
      rawArgs: args.query ? [args.query] : [],
      cmd: pickCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return { out: writes.join('').trimEnd(), exit: process.exitCode };
}

describe('pickCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-pick-'));
    await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('exits 1 when nothing is cloned', async () => {
    const { out, exit } = await runPick(dir);
    expect(out).toBe('');
    expect(exit).toBe(1);
  });

  it('exits 1 when the query matches nothing', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const { out, exit } = await runPick(dir, { query: 'nope' });
    expect(out).toBe('');
    expect(exit).toBe(1);
  });

  it('short-circuits without prompting when exactly one match', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'bar'), { recursive: true });
    const { out, exit } = await runPick(dir, { query: 'bar' });
    expect(out).toBe(join(dir, 'comGithub', 'foo', 'bar'));
    expect(exit).toBeUndefined();
  });

  it('refuses to prompt when stdin is not a TTY', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'a'), { recursive: true });
    await mkdir(join(dir, 'comGithub', 'foo', 'b'), { recursive: true });
    const { out, exit } = await runPick(dir, { query: 'foo' });
    expect(out).toBe('');
    expect(exit).toBe(1);
  });

  it('prints only the chosen path from the interactive picker', async () => {
    await mkdir(join(dir, 'comGithub', 'foo', 'a'), { recursive: true });
    const chosen = join(dir, 'comGithub', 'foo', 'b');
    await mkdir(chosen, { recursive: true });

    // Pretend we're interactive and let the prompt resolve to a choice.
    const ttyDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true
    });
    const promptSpy = vi.spyOn(consola, 'prompt').mockResolvedValue(chosen);
    try {
      const { out, exit } = await runPick(dir, { query: 'foo' });
      expect(out).toBe(chosen); // stdout carries the path only
      expect(exit).toBeUndefined();
      expect(promptSpy).toHaveBeenCalledOnce();
    } finally {
      promptSpy.mockRestore();
      if (ttyDesc) Object.defineProperty(process.stdin, 'isTTY', ttyDesc);
      else delete (process.stdin as unknown as Record<string, unknown>).isTTY;
    }
  });
});
