import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(out).toContain('forgemap list');
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

  it('includes the import and cleanup subcommands', async () => {
    const out = await runCompletion({ shell: 'bash' });
    expect(out).toContain('import');
    expect(out).toContain('cleanup');
  });

  describe('flags and enum values', () => {
    it('bash completes each subcommand with only its own flags', async () => {
      const out = await runCompletion({ shell: 'bash' });
      expect(out).toContain('clone) flags="--ssh --https --config"');
      expect(out).toContain('list) flags="--format --filter --limit --config"');
      expect(out).toContain('completion) flags="--install"');
      // clone's flags do not leak the unrelated --format flag.
      expect(out).not.toContain(
        'clone) flags="--ssh --https --config --format'
      );
    });

    it('bash offers the negated form of negatable booleans', async () => {
      const out = await runCompletion({ shell: 'bash' });
      expect(out).toContain('--cache --no-cache');
    });

    it('bash completes static enum values per flag', async () => {
      const out = await runCompletion({ shell: 'bash' });
      expect(out).toContain(
        'list:--format) COMPREPLY=( $(compgen -W "auto pretty path slug"'
      );
      expect(out).toContain(
        'status:--format) COMPREPLY=( $(compgen -W "pretty json"'
      );
      expect(out).toContain(
        'import:--type) COMPREPLY=( $(compgen -W "forgemap"'
      );
    });

    it('bash completes the shell positional for completion/shell-init', async () => {
      const out = await runCompletion({ shell: 'bash' });
      expect(out).toContain(
        'completion) COMPREPLY=( $(compgen -W "zsh bash fish"'
      );
      expect(out).toContain(
        'shell-init) COMPREPLY=( $(compgen -W "zsh bash fish"'
      );
    });

    it('zsh completes per-subcommand flags and enum values', async () => {
      const out = await runCompletion({ shell: 'zsh' });
      expect(out).toContain('clone) compadd -- --ssh --https --config;');
      expect(out).toContain('list:--format) compadd auto pretty path slug;');
      expect(out).toContain('compadd zsh bash fish');
      expect(out).toContain('--cache --no-cache');
    });

    it('fish scopes flags and enum values per subcommand', async () => {
      const out = await runCompletion({ shell: 'fish' });
      expect(out).toContain(
        "complete -c forgemap -n '__fish_seen_subcommand_from clone' -l ssh"
      );
      expect(out).toContain(
        "complete -c forgemap -n '__fish_seen_subcommand_from list' -l format -x -a 'auto pretty path slug'"
      );
      expect(out).toContain(
        "complete -c forgemap -n '__fish_seen_subcommand_from status' -l no-cache"
      );
      expect(out).toContain('__forgemap_needs_shell');
      expect(out).toContain("-n '__forgemap_needs_shell' -a 'zsh bash fish'");
    });
  });

  describe('--install', () => {
    let home: string;
    let originalHome: string | undefined;

    beforeEach(async () => {
      home = await mkdtemp(join(tmpdir(), 'forgemap-comp-home-'));
      originalHome = process.env.HOME;
      process.env.HOME = home;
    });

    afterEach(async () => {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await rm(home, { recursive: true, force: true });
    });

    it('appends a guarded completion loader, idempotently', async () => {
      await runCompletion({ shell: 'zsh', install: true });
      await runCompletion({ shell: 'zsh', install: true });
      const rc = await readFile(join(home, '.zshrc'), 'utf8');
      expect(rc).toContain('# >>> forgemap completion >>>');
      expect(rc).toContain('eval "$(forgemap completion zsh)"');
      const count = rc.split('# >>> forgemap completion >>>').length - 1;
      expect(count).toBe(1);
    });
  });
});
