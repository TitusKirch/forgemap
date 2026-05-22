import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shellInitCommand } from '../src/commands/shell-init.ts';

async function runShellInit(
  args: Record<string, unknown> = {}
): Promise<string> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await shellInitCommand.run!({
      args: { ...args, _: [] },
      rawArgs: [],
      cmd: shellInitCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return writes.join('');
}

describe('shellInitCommand', () => {
  let originalShell: string | undefined;

  beforeEach(() => {
    originalShell = process.env.SHELL;
    process.exitCode = undefined;
  });

  afterEach(() => {
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    process.exitCode = undefined;
  });

  it('emits a zsh/bash function by default (from $SHELL)', async () => {
    process.env.SHELL = '/bin/zsh';
    const out = await runShellInit({ name: 'fcd' });
    expect(out).toContain('fcd() {');
    expect(out).toContain('forgemap search');
    expect(out).toContain('forgemap pick');
  });

  it('emits fish syntax when asked', async () => {
    const out = await runShellInit({ shell: 'fish', name: 'fcd' });
    expect(out).toContain('function fcd');
    expect(out).toContain('end');
    expect(out).not.toContain('fcd() {');
  });

  it('honours --name', async () => {
    const out = await runShellInit({ shell: 'bash', name: 'myrepo' });
    expect(out).toContain('myrepo() {');
    expect(out).not.toContain('fcd() {');
  });

  it('rejects unsupported shells', async () => {
    const out = await runShellInit({ shell: 'powershell' });
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
  });
});
