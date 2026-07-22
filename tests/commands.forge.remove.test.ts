import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import consola from 'consola';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgeRemoveCommand } from '../src/commands/forge/remove.ts';
import { runCli } from './helpers/citty.ts';

const CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'git', host: 'git.example.com', dir: 'work' }
  }
};
`;

/** consola.prompt resolves to null on cancel; its types don't model that. */
const CANCELLED = null as unknown as string;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    value,
    configurable: true
  });
}

describe('forge remove', () => {
  let dir: string;
  let cwd: string;
  const config = 'forgemap.config.ts';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-remove-'));
    cwd = process.cwd();
    process.chdir(dir);
    process.exitCode = undefined;
    setTTY(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    setTTY(false);
  });

  it('removes a forge via flag', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeRemoveCommand, ['work', '--yes']);
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('git.example.com');
    expect(written).toContain('github: {');
  });

  it('reassigns the default when removing it', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeRemoveCommand, ['github', '--default', 'work', '--yes']);
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('github: {');
    expect(written).toContain("defaultForge: 'work'");
  });

  it('rejects reassigning the default to a non-remaining forge', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeRemoveCommand, [
      'github',
      '--default',
      'nope',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
    const written = await readFile(config, 'utf8');
    expect(written).toContain('github: {');
  });

  it('warns but proceeds when removing the default without a reassignment', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeRemoveCommand, ['github', '--yes']);
    expect(res.exit).toBeUndefined();
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('github: {');
    // defaultForge intentionally left dangling (allowed)
    expect(written).toContain("defaultForge: 'github'");
  });

  it('rejects an unknown forge key', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeRemoveCommand, ['nope', '--yes']);
    expect(res.exit).toBe(1);
  });

  it('errors when there is no config file', async () => {
    const res = await runCli(forgeRemoveCommand, ['work', '--yes']);
    expect(res.exit).toBe(1);
  });

  it('requires a key when non-interactive', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeRemoveCommand, ['--yes']);
    expect(res.exit).toBe(1);
  });

  it('prompts to pick the forge and a new default when interactive', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    const prompt = vi
      .spyOn(consola, 'prompt')
      .mockResolvedValueOnce('github') // which forge
      .mockResolvedValueOnce('work') // new default
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeRemoveCommand, []);
    expect(prompt).toHaveBeenCalledTimes(3);
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('github: {');
    expect(written).toContain("defaultForge: 'work'");
  });

  it('aborts when the forge selection is cancelled', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt').mockResolvedValueOnce(CANCELLED);
    await runCli(forgeRemoveCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).toContain('github: {');
    expect(written).toContain('git.example.com');
  });
});
