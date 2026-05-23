import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('emits a zsh/bash wrapper that intercepts cd', async () => {
    process.env.SHELL = '/bin/zsh';
    const out = await runShellInit({ name: 'forgemap' });
    expect(out).toContain('forgemap() {');
    expect(out).toContain('if [ "$1" = "cd" ]');
    expect(out).toContain('command forgemap');
    expect(out).toContain('builtin cd');
  });

  it('emits fish syntax when asked', async () => {
    const out = await runShellInit({ shell: 'fish', name: 'forgemap' });
    expect(out).toContain('function forgemap');
    expect(out).toContain('end');
    expect(out).toContain('builtin cd');
    expect(out).not.toContain('forgemap() {');
  });

  it('honours --name for a custom wrapper name', async () => {
    const out = await runShellInit({ shell: 'bash', name: 'fm' });
    expect(out).toContain('fm() {');
    expect(out).not.toContain('forgemap() {');
  });

  it('rejects unsupported shells', async () => {
    const out = await runShellInit({ shell: 'powershell' });
    expect(out).toBe('');
    expect(process.exitCode).toBe(1);
  });

  describe('--install', () => {
    let home: string;
    let originalHome: string | undefined;

    beforeEach(async () => {
      home = await mkdtemp(join(tmpdir(), 'forgemap-home-'));
      originalHome = process.env.HOME;
      process.env.HOME = home;
    });

    afterEach(async () => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await rm(home, { recursive: true, force: true });
    });

    it('appends a guarded loader block to ~/.zshrc', async () => {
      await runShellInit({ shell: 'zsh', name: 'forgemap', install: true });
      const rc = await readFile(join(home, '.zshrc'), 'utf8');
      expect(rc).toContain('# >>> forgemap shell-init >>>');
      expect(rc).toContain('eval "$(forgemap shell-init zsh)"');
      expect(rc).toContain('# <<< forgemap shell-init <<<');
    });

    it('is idempotent (no duplicate block on re-run)', async () => {
      await runShellInit({ shell: 'zsh', install: true });
      await runShellInit({ shell: 'zsh', install: true });
      const rc = await readFile(join(home, '.zshrc'), 'utf8');
      const count = rc.split('# >>> forgemap shell-init >>>').length - 1;
      expect(count).toBe(1);
    });

    it('uses `| source` for fish and creates the config dir', async () => {
      await runShellInit({ shell: 'fish', install: true });
      const rc = await readFile(
        join(home, '.config', 'fish', 'config.fish'),
        'utf8'
      );
      expect(rc).toContain('forgemap shell-init fish | source');
    });

    it('includes --name when a custom name is used', async () => {
      await runShellInit({ shell: 'bash', name: 'fm', install: true });
      const rc = await readFile(join(home, '.bashrc'), 'utf8');
      expect(rc).toContain('eval "$(forgemap shell-init bash --name fm)"');
    });
  });
});
