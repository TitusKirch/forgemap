import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completionCommand } from '../src/commands/completion.ts';

async function runCompletion(
  args: Record<string, unknown> = {}
): Promise<string> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    await completionCommand.run!({
      args: { ...args, _: [] },
      rawArgs: [],
      cmd: completionCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return writes.join('');
}

describe('completionCommand', () => {
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

  it('emits a bash completion function', async () => {
    const out = await runCompletion({ shell: 'bash' });
    expect(out).toContain('_forgemap_completion');
    expect(out).toContain('complete -F');
    expect(out).toContain('forgemap search');
  });

  it('emits a zsh compdef', async () => {
    const out = await runCompletion({ shell: 'zsh' });
    expect(out).toContain('_forgemap');
    expect(out).toContain('compdef');
    expect(out).toContain('_describe');
  });

  it('emits a fish completion block', async () => {
    const out = await runCompletion({ shell: 'fish' });
    expect(out).toContain('complete -c forgemap');
    expect(out).toContain('__forgemap_needs_slug');
  });

  it('auto-detects from $SHELL', async () => {
    process.env.SHELL = '/usr/bin/fish';
    const out = await runCompletion({});
    expect(out).toContain('complete -c forgemap');
  });

  it('rejects unsupported shells', async () => {
    const out = await runCompletion({ shell: 'powershell' });
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
  });
});
